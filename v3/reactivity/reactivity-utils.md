### 响应式工具集

基本上`compostions API`的响应式`API`部分已经解析的差不多了，还有一些小的工具类型的方法在开发中也会使用到值得一看，
我们将会看一下实现原理，在简单聊一些可能的使用场景。

## `unref`

用来解包`ref`对象，当我们在开发中使用`ref`越来越多总会遇到`ref`类型和其他类型的差别处理，`unref`就是帮助你处理这种情况的方法。

```typescript
// reactivity/ref.ts
export function unref<T>(ref: T): T extends Ref<infer V> ? V : T {
  return isRef(ref) ? (ref.value as any) : ref;
}
export function isRef(r: any): r is Ref {
  return r ? r.__v_isRef === true : false;
}
```

简单的通过`__v_isRef`标识来确定类型，返回最终的值。

## `toRef` 和 `toRefs`

我们知道`reactive`返回的是一个代理对象，我们没办法通过`...`扩展运算符来展开属性的同时还保持响应式特性，
这种情况下就是`toRefs`的使用场景，这非常适合在做一些状态封装时，让使用者能解构出响应式状态：

```typescript
function useFeatureX() {
  const state = reactive({
    foo: 1,
    bar: 2,
  });
  return toRefs(state);
}
// 可以解构，不会丢失响应性
const { foo, bar } = useFeatureX();
```

原理：

```typescript
// reactivity/ref.ts
export function toRefs<T extends object>(object: T): ToRefs<T> {
  只能接受代理对象;
  if (__DEV__ && !isProxy(object)) {
    console.warn(
      `toRefs() expects a reactive object but received a plain one.`
    );
  }
  const ret: any = {};
  for (const key in object) {
    ret[key] = toRef(object, key);
  }
  // 返回的是一个普通对象
  return ret;
}

export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K
): Ref<T[K]> {
  // 包装代理对象的某个属性
  return {
    __v_isRef: true,
    get value(): any {
      return object[key];
    },
    set value(newVal) {
      object[key] = newVal;
    },
  } as any;
}
```

实现方式还是非常简单的，需要注意的是`toRefs`会返回一个普通对象，对象的每一项都是一个`Ref`类型。

## 类型判断方法

`Vue3`还提供了一系列的类型判断方法来区分`proxy`、`ref`、`reactive`、`readonly`的类型。

- #### `isRef`
  检查一个值是否为一个 ref 对象。

```typescript
// reactivity/ref.ts
export function isRef(r: any): r is Ref {
  return r ? r.__v_isRef === true : false;
}
```

这个已经在上文提到过。

- #### `isReadonly`
  检查一个对象是否是由 readonly 创建的只读代理。

```typescript
// reactivity/reactive.ts
export function isReadonly(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY]);
}
```

通过在创建代理时打上的标识`__v_isReadonly`来判断。

- #### `isReactive`
  检查一个对象是否是由 reactive 创建的响应式代理。  
  如果这个代理是由 readonly 创建的，但是又被 reactive 创建的另一个代理包裹了一层，那么同样也会返回 true。

```typescript
// reactivity/reactive.ts
export function isReactive(value: unknown): boolean {
  if (isReadonly(value)) {
    return isReactive((value as Target)[ReactiveFlags.RAW]);
  }
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE]);
}
```

我们在前文解析`readonly`时就已经了解到`readonly`的特性是允许通过对只读代理的访问来侦听原对象的变化，
所以在`readonly`的情况我们还需要看看原对象是否为响应式对象；而其他情况就直接通过`__v_isReactive`标识判断

- #### `isProxy`
  检查一个对象是否是由 reactive 或者 readonly 方法创建的代理:

```typescript
// reactivity/reactive.ts
export function isProxy(value: unknown): boolean {
  return isReactive(value) || isReadonly(value);
}
```

只要对象是由`reactive`或者`readonly`创建的，它就是一个代理过的对象。

## 与原始对象相关

- #### `toRaw`
  返回由 reactive 或 readonly 方法转换成响应式代理的普通对象。  
  我们就能临时的获取到原对象进行读取和修改，并且不会触发更新和依赖收集。

```typescript
// reactivity/reactive.ts
export function toRaw<T>(observed: T): T {
  return (
    (observed && toRaw((observed as Target)[ReactiveFlags.RAW])) || observed
  );
}
```

在创建代理对象时我们就解析到会将原对象的引用保留在代理对象的`__v_raw`属性上，所以我们直接取，并且兼容普通对象直接返回自身。

- #### `markRaw`
  显式标记一个对象为“永远不会转为响应式代理”，函数返回这个对象本身。

```typescript
// reactivity/reactive.ts
export function markRaw<T extends object>(value: T): T {
  def(value, ReactiveFlags.SKIP, true);
  return value;
}
```

在传入对象上打上`__v_skip`为`true`的标识，在创建代理对象时就会跳过代理。  
我们需要注意的是`markRaw`是浅层的标记，对于一个嵌套对象来说，内层的嵌套对象并不会被标记为用不可专为响应式代理。

```typescript
const obj = markRaw({ a: 1, b: { c: 1 } });
// 将会代理成功
const proxyb = reactive(obj.b);
proxyb !== obj.b;
```

## 总结

这几乎是`compostions API`工具集的全部了，更清楚的认识到这些工具函数的原理才能避免在使用时的错误操作，
就比如`markRaw`的浅层标记特性并没有从命名上体现，但是确实我们需要注意的点。
