### 浅层代理

在`Composition`家族中还存在着一类浅代理的`API`：`shallowRef`、`shallowReactive`和`shallowReadonly`，
浅层代理的行为是仅代理自身这层，不会进行递归代理；例如：

```typescript
const obj = shallowReactive({ foo: 1, bar: { a: 1 } });
// 触发响应
obj.foo++;
// 不会触发响应式
obj.bar.a++;

const objRef = shallowRef({ a: 1 });
// 触发响应
objRef.value = { a: 2 };
// 不会触发响应式
objRef.value.a++;

const objRO = shallowReadonly({ foo: 1, bar: { a: 1 } });
// 不可修改
objRO.foo++;
// 可以修改
objRO.bar.a++;
```

## 本篇目标

1. 理解浅层代理是如何控制递归代理的
2. 浅层代理的行为特性

## 解析

### - `shallowRef`

```typescript
// reactivity/ref.ts
export function shallowRef(value?: unknown) {
  return createRef(value, true);
}
function createRef(rawValue: unknown, shallow = false) {
  if (isRef(rawValue)) {
    return rawValue;
  }
  // 浅层代理控制
  let value = shallow ? rawValue : convert(rawValue);
  const r = {
    __v_isRef: true,
    get value() {
      track(r, TrackOpTypes.GET, "value");
      return value;
    },
    set value(newVal) {
      if (hasChanged(toRaw(newVal), rawValue)) {
        rawValue = newVal;
        // 浅层代理控制
        value = shallow ? newVal : convert(newVal);
        trigger(
          r,
          TriggerOpTypes.SET,
          "value",
          __DEV__ ? { newValue: newVal } : void 0
        );
      }
    },
  };
  return r;
}
```

我们需要关注的也就是和`shallow`相关的逻辑，如果是浅层代理我们将不会去递归代理。
可以看到`shallowRef`的`track/trigger`发生在访问`.value`时。

### - `shallowReactive` 和 `shallowReadonly`

#### `shallowGet`

```typescript
// reactivity/baseHandlers.ts
const shallowGet = /*#__PURE__*/ createGetter(false, true);
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true);
function createGetter(isReadonly = false, shallow = false) {
  return function get(target: object, key: string | symbol, receiver: object) {
    // 1. reactive标识位处理
    // 2. 处理数组方法key
    // 3. 取值
    // 4. 过滤无需track的key
    // 5. 依赖收集
    if (shallow) {
      return res;
    }
    // 非shallow
    return res;
  };
}
```

在`get`拦截器中`shallow`通过直接返回取值来拦截后续的递归代理以达到浅层代理的效果。

#### `shallowGet`

```typescript
// reactivity/baseHandlers.ts
const shallowSet = /*#__PURE__*/ createSetter(true);
function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    // 取旧值
    if (!shallow) {
      // 深度代理情况下，我们需要手动处理属性值为ref的情况，将trigger交给ref来触发
    } else {
      // 浅代理模式下，行为与普通对象一致
    }
    // 判断是新增或者修改
    // 设置新值
    // 如果修改了通过原型查找得到的属性，无需trigger
    return result;
  };
}
```

我们可以看到在`shallowReactive`中不会对对象中的`ref`类型的属性进行解包操作，同时也仅会对第一层进行代理，
内层的嵌套对象访问行为就不会走`proxyHandler`。

## 总结

这就是`shallow`的原理通过控制递归代理来实现，同时我们对于浅层代理的行为也有所了解，
特别是对于`shallowReactive`和`shallowReadonly`不会对`ref`类型属性进行解包操作。
