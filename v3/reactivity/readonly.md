### 只读代理

在`reactive`解析完成的基础上，我们可以说是对于`Vue3`代理的处理方式已经很了解了，这一节我们会关注`readonly`这个代理操作。
我们依旧先看它的行为方式：  
`readonly`接受一个对象（响应式或普通）或`ref`，返回一个只读的代理，这个只读代理是深度的代理，也就意味着会在每一层嵌套对象都进行只读代理。

```typescript
const original = reactive({ count: 0 });

const copy = readonly(original);

watchEffect(() => {
  // 依赖追踪
  console.log(copy.count);
});

// original 上的修改会触发 copy 上的侦听
original.count++;

// 无法修改 copy 并会被警告
copy.count++; // warning!
```

## 本篇目标

1. 理解`readonly`的实现原理
2. 了解`readonly`的行为特性

## 解析

```typescript
// reactivity/reactive.ts
export function readonly<T extends object>(
  target: T
): DeepReadonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers
  );
}
```

和`reactive`类似我们直接关注`readonlyHandlers`。

## `get`拦截器

```typescript
// reactivity/baseHandlers.ts
const readonlyGet = /*#__PURE__*/ createGetter(true);

function createGetter(isReadonly = false, shallow = false) {
  return function get(target: object, key: string | symbol, receiver: object) {
    // 1. reactive标识位处理
    // 2. 处理数组方法key
    // 3. 取值
    // 4. 过滤无需track的key

    if (!isReadonly) {
      track(target, TrackOpTypes.GET, key);
    }

    // 6. 处理取出的值
    if (shallow) {
      // 浅代理则直接返回通过key取到的值
      return res;
    }

    if (isRef(res)) {
      // 如果通过key去除的是ref，则自动解开，仅针对对象
      return targetIsArray ? res : res.value;
    }

    if (isObject(res)) {
      // 如果通过key取出是对象，且shallow为false，进行递归代理
      return isReadonly ? readonly(res) : reactive(res);
    }

    return res;
  };
}
```

和`reactive`的`get`和拦截器最大的不同就是`readonly`不会进行依赖收集，同样在处理深度代理的情况，
会在取值时进行递归代理。

## `set`拦截器

```typescript
set(target, key) {
  // 开发环境抛出不可修改警告
  if (__DEV__) {
    console.warn(
      `Set operation on key "${String(key)}" failed: target is readonly.`,
      target
    )
  }
  return true
}
```

由于是只读代理`set`的处理就直接不作任何操作。

## 总结

`readonly`的代理默认为深度代理，而且是返回一个新的代理对象并不会影响原对象，只读对象不会进行`track/trigger`，
但是依旧能通过对只读对象的访问侦听到原对象的更改（仅针对响应式对象和`ref`），因为只读对象的`get`会触发原对象的`track`。
