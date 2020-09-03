### `computed`揭秘

`Vue3`中的计算属性已经被函数化，新的`API`形态如下：

```typescript
const count = ref(1);
const plusOne = computed({
  get: () => count.value + 1,
  set: (val) => {
    count.value = val - 1;
  },
});
const plusTwo = computed(() => count.value + 2);
plusOne.value;
plusTwo.value;
```

依旧是接收一个`getter`和`setter`返回的是一个`ref`类型，
我们谈论计算属性时说的最多的就是它拥有缓存特性和延迟求值，我们就从计算属性的这两个特性出发来探究它背后的原理。

## 本篇目标

1. 理解`computed`的实现原理
2. 理解计算属性的缓存和延迟求值特性

## 函数概览

我从源码中提取出`computed`的类型声明如下：

```typescript
// 只读的
function computed<T>(getter: () => T): Readonly<Ref<Readonly<T>>>;
// 可更改的
function computed<T>(options: {
  get: () => T;
  set: (value: T) => void;
}): Ref<T>;
```

## 解析

我们直接看到`computed`的函数体：

```typescript
// reactivity/computed.ts
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  // 1. 处理getter/setter
  let getter: ComputedGetter<T>;
  let setter: ComputedSetter<T>;

  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions;
    setter = __DEV__
      ? () => {
          console.warn("Write operation failed: computed value is readonly");
        }
      : NOOP;
  } else {
    getter = getterOrOptions.get;
    setter = getterOrOptions.set;
  }
  // 是否需要重新求值
  let dirty = true;
  // 缓存当前值
  let value: T;
  let computed: ComputedRef<T>;
  // 2. 创建getter 副作用函数
  const runner = effect(getter, {
    lazy: true,
    scheduler: () => {
      if (!dirty) {
        dirty = true;
        trigger(computed, TriggerOpTypes.SET, "value");
      }
    },
  });
  // 3. 创建computed ref
  computed = {
    // 标识为ref对象
    __v_isRef: true,
    // 只读标识
    [ReactiveFlags.IS_READONLY]:
      isFunction(getterOrOptions) || !getterOrOptions.set,

    // 向外暴露副作用函数，便于stop
    effect: runner,
    get value() {
      // 需要求取新值就运行runner
      if (dirty) {
        value = runner();
        dirty = false;
      }
      // 触发依赖收集
      track(computed, TrackOpTypes.GET, "value");
      return value;
    },
    set value(newValue: T) {
      setter(newValue);
    },
  } as any;
  return computed;
}
```

我们依次来解析：

- ### 1. 处理 getter/setter

  由于`computed`可以接收两种参数，我们需要预处理一下`getter/setter`，只传`getter`时，
  在开发环境下还会生成一个警示的`setter`函数以提醒开发。

- ### 2. 创建 getter 副作用函数

  在`computed`内部使用了`effect`包裹`getter`函数，注意此时`effect`的第二个参数，
  将`lazy`设置成`true`并且传入了调度函数；我们知道`effect`在被`trigger`时，
  如果存在调度函数则会直接将`effect`传入调度函数来执行。可是这里传入的调度函数并没有使用传入的`effect`参数，
  这里我们需要存疑一下。再说`lazy`属性为`true`时，是不会立即执行`effect`的，我们需要手动调用`runner`来进行首次执行，
  这里我们也存疑一下，是在何时首次调用`runner`的。

- ### 3. 创建 computed ref
  `computedRef`的创建还是蛮简单的，我们需要关注的是`get`的实现，我们注意到`get`返回的是`computed`函数作用域下的`value`，
  也就意味着`computedRef.value`是通过维护这个值来提供的；在`get`函数内部我们看到了当`dirty`为`true`时会执行`runner`来求值，
  我们思考一下在访问`computedRef.value`时如果需要求新值我们就计算`runner`来求值并更新`value`，如果不需要则直接返回`value`。

#### 那么我们怎么知道何时需要求新值呢？

要回答这个问题我们还得回到`runner`的声明，我们在副作用函数的调度函数选项中传入了这样一段逻辑：

```typescript
() => {
  if (!dirty) {
    dirty = true;
    trigger(computed, TriggerOpTypes.SET, "value");
  }
};
```

我们先考虑这段逻辑何时执行，当我们第一次访问`computedRef.value`时会执行`runner`，
经过上一节的解析我们知道`effect`返回的是一个包裹`getter`的副作用函数，
我们执行`runner`就会触发`getter`内部访问的响应式变量的依赖收集，
而当我们`getter`依赖的响应式数据发生变化是就会`trigger`以重新执行`runner`，
但是我们传递了调度函数选项`runner`的调用就会以`scheduler`的形式来调用，这就回到了我们的疑惑何时执行`scheduler`;
正是`getter`依赖的响应式数据产生变化时。  
我们看到`scheduler`的内部实现，发现里面并没有进行直接通过`getter`求值，
而是在`dirty`为`false`时去触发`computedRef`的`trigger`；这就意味着此时依赖于`computedRef`的副作用函数会重新执行，
而在这个副作用函数中一定会对`computedRef`产生`get`访问，此时又回到`get`函数内部发现`drity`为需要求值，就执行`runner`进行真实的求值。  
我们仔细体会这个过程我们不难发现需要求新值的时刻就发生在`computed`传入`getter`所依赖的响应式数据发生改变的时候。

## `computed`整体流程图

光从文字的角度来描述`computed`的流程可能不是那么具象，于是我画了一张流程图如下：  
![computed](/vue3-analysis/reactivity/computed.jpg)

通过这张图可以描述用户操作的`get`和`set`是如何触发`computed`内部计算的，`computed`的缓存性就在于，
需要`getter`依赖的响应式变化了才会重新计算求值，而延迟求值，则体现在需要求值是通过`dirty`来维护，
在用户触发`get`时进行实际的求值。

## 总结

本篇我们着重讨论了`computed`的巧妙实现原理，也看到了`effect`函数的一次教科书式的使用指南，
正是有了强大的依赖收集和派发更新我们才能组合出无限的可能。下一节我们会看`effect`的另一个应用`watch API`.
