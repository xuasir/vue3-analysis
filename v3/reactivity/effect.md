### `effect`副作用函数

在上一节讨论`track`和`trigger`时，都提到了`effect`副作用函数，那么副作用函数到底是什么呢？
我们先看一下`effect`如何使用：

```typescript
let num = ref(0);
effect(() => console.log(num.value));
// console.log --> 0
num.value += 1;
// console.log --> 1
```

`effect`接受一个函数作为参数，当所接收函数内使用的响应式数据变更，能够自动重新执行这个函数；听起来似乎很魔法，
让我们详细看看`effect`是如何工作的？

## 本篇目标

> 1. 了解`effect`是如何实现
> 2. 理解`effect`是如何与`track`、`trigger`协作的

## 全局变量提前声明

- #### `shouldTrack`
  ::: details 点击查看详细代码

```typescript
// 当前shouldTrack状态
let shouldTrack = true;
// 历史shouldTrack状态栈
const trackStack: boolean[] = [];
// 暂停收集
export function pauseTracking() {
  trackStack.push(shouldTrack);
  shouldTrack = false;
}
// 开启收集
export function enableTracking() {
  trackStack.push(shouldTrack);
  shouldTrack = true;
}
// 重置当前shouldTrack状态
export function resetTracking() {
  const last = trackStack.pop();
  shouldTrack = last === undefined ? true : last;
}
```

:::

- #### `effect`
  ::: details 点击查看详细代码

```typescript
// effect栈
const effectStack: ReactiveEffect[] = [];
// 当前effect
let activeEffect: ReactiveEffect | undefined;
```

:::

- #### `effect`配置项
  ::: details 点击查看详细代码

```typescript
export interface ReactiveEffectOptions {
  // 是否为lazy模式
  lazy?: boolean;
  // 执行副作用函数的调度器
  scheduler?: (job: ReactiveEffect) => void;
  // debugger函数
  onTrack?: (event: DebuggerEvent) => void;
  onTrigger?: (event: DebuggerEvent) => void;
  // 副作用停止的钩子函数
  onStop?: () => void;
}
```

:::

## 解析`effect`

我们直接看到`effect`的函数体：

```typescript
// reactivity/effect.ts
export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  // 传入副作用函数，取原函数
  if (isEffect(fn)) {
    fn = fn.raw;
  }
  const effect = createReactiveEffect(fn, options);
  // 配置了lazy，不会立即执行
  if (!options.lazy) {
    effect();
  }
  return effect;
}
// effect 唯一标识
let uid = 0;

function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  const effect = function reactiveEffect(): unknown {
    if (!effect.active) {
      // 非激活状态处理
      return options.scheduler ? undefined : fn();
    }
    // 确保副作用栈栈中没有当前副作用函数
    if (!effectStack.includes(effect)) {
      // 清除副作用函数依赖
      cleanup(effect);
      try {
        // 开启收集
        enableTracking();
        // 设置当前副作用函数为激活副作用
        effectStack.push(effect);
        activeEffect = effect;
        // 执行 fn
        return fn();
      } finally {
        // 恢复副作用栈和激活副作用以及收集状态
        effectStack.pop();
        resetTracking();
        activeEffect = effectStack[effectStack.length - 1];
      }
    }
  } as ReactiveEffect;
  // 添加唯一标识
  effect.id = uid++;
  // 标识为副作用函数
  effect._isEffect = true;
  // 激活副作用函数
  effect.active = true;
  // 保存原函数
  effect.raw = fn;
  // 初始化依赖数组
  effect.deps = [];
  // 保存配置选项
  effect.options = options;
  return effect;
}
```

可以看到`effect`是负责预处理`fn`确保`fn`是一个非`effect`函数，真正的`effect`函数是由`createReactiveEffect`来创建的，
`lazy`选项和`computed`强相关，配置成`true`会使得`effect`默认不立即执行。  
我们再看到`createReactiveEffect`内部，原来`effect`仅是一个包裹函数，在他的内部来执行`fn`和处理`effectStack`相关内容，
我们逐步分析一下各个步骤：

- #### 处理激活状态

  `effect.active`来表示副作用函数的激活状态，在`stop`一个副作用函数后会将其置成`false`，非激活状态的`effect`函数被调用，
  如果不存在调度会直接执行。

- #### 清除操作
  ::: tip 注意
  `effect.deps`是一个数组，存储的是该`effect`依赖的每个属性的`depsSet`副作用函数表  
  `track`阶段建立的依赖存储表中，每个响应式对象触发依赖收集的`key`都会对应一个副作用的`Set`表下文以`depsSet`来称呼
  :::
  在正式开始执行`fn`前，会先`cleanup`当前`effect`的`deps`；`effect`的`deps`存储是的当前`effect`依赖属性的副作用`depsSet`表，
  这是一个双向指针的处理方式，不仅在`track`的时候，会将副作用函数与`target --> key --> depsSet`关联起来，
  同时也会保持`depsSet`的引用存储在`effect.deps`上；这样做的意义就在于现在的`cleanup`操作，
  我们能在`effect`再次执行之前，从所有收集到此`effect`函数的`depsSet`中剔除该`effect`，以便在此次`effect`执行时重新收集；
  这一步操作的意义在于如下场景：

```vue
<template>
  <div v-if="showFalg">
    {{ num1 }}
  </div>
  <div>
    {{ num2 }}
  </div>
</template>
<script>
export default {
  setup() {
    const showFalg = ref(true);
    const num1 = ref(0);
    const num2 = ref(0);
    return {
      showFalg,
      num1,
      num2,
    };
  },
};
</script>
```

我们知道模板的执行是一个副作用渲染函数，首次渲染会将当前组件的副作用渲染函数收集到`showFalg, num1`对应的`depsSet`中，
我们改变`showFalg`，触发渲染函数重新执行，此时如果我们不进行`cleanup`，`num1, num2, showFalg`都会收集到副作用渲染函数，
而`num1`是并未显示在页面，我们更改它的时候并不需要触发渲染函数的重新渲染。只有在重新执行副作用渲染函数之前进行`cleanup`操作，
才能确保每次渲染函数执行后依赖收集的正确性

- #### 执行`fn`
  `fn`的执行采用`try...finally`来包裹，以确保就算`fn`执行出错还是能保证`effectStack, activeEffect`的正确维护，
  在正式执行`fn`之前，会有一个压栈的操作，由于`effect`的执行会存在嵌套的情况比如组件渲染函数的执行遇到了子组件会跳到子组件的渲染函数中，
  函数的嵌套调用本就是一个栈结构，而栈的先进后出性质能很好保证`activeEffect`的正确回退；
  `fn`执行完成后，就进行出栈操作，跳回到上一个`effect`中。

## 总结

这就是`effect`的执行全过程，在`fn`执行之前修正`activeEffect`的指向，
然后再`fn`的执行中会访问到响应式数据从而触发`track`将副作用函数作为依赖收集起来。
这样就串起来整个`effect`和`track`以及`trigger`。
下一节我们来解析一个`effect`、`track`以及`trigger`综合使用的案例——`computed`。
