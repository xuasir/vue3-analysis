### 自定义`ref`

我们之前深度解析了`ref`的原理，现在我们会看一个更加灵活的`ref`创建方式`customRef`，我们依旧先看它的`API`形态：

```typescript
customRef((track, trigger) => {
  return {
    get() {
      track();
      return value;
    },
    set(newValue) {
      value = newValue;
      trigger();
    },
  };
});
```

`customRef`可接收一个工厂函数，参数分别为`track`和`trigger`，并且返回一个带有`get`和`set`的对象，
我们能灵活的控制`track/trigger`的时机。

## 类型声明

```typescript
// reactivity/ref.ts
export type CustomRefFactory<T> = (
  track: () => void,
  trigger: () => void
) => {
  get: () => T;
  set: (value: T) => void;
};
export function customRef<T>(factory: CustomRefFactory<T>): Ref<T>;
```

## 解析

```typescript
export function customRef<T>(factory: CustomRefFactory<T>): Ref<T> {
  const { get, set } = factory(
    () => track(r, TrackOpTypes.GET, "value"),
    () => trigger(r, TriggerOpTypes.SET, "value")
  );
  const r = {
    __v_isRef: true,
    get value() {
      return get();
    },
    set value(v) {
      set(v);
    },
  };
  return r as any;
}
```

实现起来非常简单，将`track`和`trigger`作为参数传递给工厂函数来获取`get/set`，最终返回一个包装的`ref`对象。

## 实战

这里的实战案例来自[composition RFC](https://composition-api.vuejs.org/zh/api.html#customref)，
创建一个防抖的`ref`。

```typescript
function useDebouncedRef(value, delay = 200) {
  let timeout;
  return customRef((track, trigger) => {
    return {
      get() {
        track();
        return value;
      },
      set(newValue) {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          value = newValue;
          trigger();
        }, delay);
      },
    };
  });
}
```

可以看到`customRef`带来的灵活性是很容易与我们的逻辑相结合诞生出新的魔法函数的。

## 总结

`customRef`的意义就在于能为我们提供灵活的`track/trigger`控制，而这一简单的灵活性带来的可塑性是巨大的。
