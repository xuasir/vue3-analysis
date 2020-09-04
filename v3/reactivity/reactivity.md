### `reactive` 和 `ref`

在`Vue2`中创建响应式数据有两种方式，一是将数据放在`data`中返回封装性较强的使用方式，二是使用`Vue2.6`推出的`Vue.observable`
较为接近`Vue3`的`API`形态；在`Vue3`的`reactivity`中暴露了更多底层的响应式方法，来让我们灵活的创建响应式对象，
其中`reactivity`和`ref`就是最为核心的两个`API`。  
由于基本值类型是没有办法被`proxy`的，以至于要产生`ref`这个`API`，他是一个包装类型，用来包装基本数据类型以变成响应式；
`API`形态如下：

```JavaScript
const numRef = ref(0)
// getter
numRef.value
//setter
numRef.value = 1

const object = reactive({
  num: 0
})
// getter
object.num
// setter
object.num = 1
```

在`Vue3 composition API`的体系下，我们可能不得不面临基本类型、`ref`包装类型和对象不同处理的心智负担；
这也是响应式对象不再依赖`this`不得不做出的改变。

## 本篇目标

1. 了解`reactive`实现方式
2. 了解`ref`实现范式

## 前置知识

在解析前我们需要了解如下的`es6`特性：

- [`Proxy`](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Proxy)
- [`Map`](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Map)
- [`Set`](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Set)

## 全局变量提前声明

- #### 对象标记

```typescript
// reactivity/reactive.ts
export const enum ReactiveFlags {
  // 跳过reactive
  SKIP = "__v_skip",
  // 是否是reactive对象
  IS_REACTIVE = "__v_isReactive",
  // 是否是只读对象
  IS_READONLY = "__v_isReadonly",
  // 代理的原对象
  RAW = "__v_raw",
  // 代理后的reactive对象
  REACTIVE = "__v_reactive",
  // 代理后的只读对象
  READONLY = "__v_readonly",
}

interface Target {
  [ReactiveFlags.SKIP]?: boolean;
  [ReactiveFlags.IS_REACTIVE]?: boolean;
  [ReactiveFlags.IS_READONLY]?: boolean;
  [ReactiveFlags.RAW]?: any;
  [ReactiveFlags.REACTIVE]?: any;
  [ReactiveFlags.READONLY]?: any;
}
```

- #### 依赖收集和派发更新的类型

```typescript
// reactivity/operations.ts
export const enum TrackOpTypes {
  GET = "get",
  HAS = "has",
  ITERATE = "iterate",
}

export const enum TriggerOpTypes {
  SET = "set",
  ADD = "add",
  DELETE = "delete",
  CLEAR = "clear",
}
```

## `reactive`解析

我们首先来解析`reactive`，因为对象的代理更加符合直觉，可以使我们先了解响应式的整体逻辑，再去理解`ref`会更加容易。  
`Vue3`的响应式实现与`Vue2`的思路还是大体一致的，依旧依赖于依赖收集和派发更新两个部分。
我们直接来到`reactivity/reactive.ts`找到`reactive`方法：

```typescript
// reactivity/reactive.ts
export function reactive(target: object) {
  // 如果已经是只读对象，返回自身
  if (target && (target as Target)[ReactiveFlags.IS_READONLY]) {
    return target;
  }
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers
  );
}
```

`reactive`并不是直接创建代理的方法仅做了一层只读对象的代理，它是一个高阶函数用来返回来另一个真实的创建响应式对象的函数；
这样做其实是为了通过高阶函数来固定参数以最简洁的参数形态导出更高阶的`ractive`、`shallowReadonly`等等方法。  
我们继续看到`createReactiveObject`函数体：

```typescript
// reactivity/reactive.ts
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>
) {
  if (!isObject(target)) {
    // 传入的不是对象，会直接返回本身
    // 开发环境下提出警告
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`);
    }
    return target;
  }
  // 如果target已经是一个reactive对象，直接返回
  // 除了使用readonly的情况，可以作用在reactive对象
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target;
  }
  // 获取代理类型
  const reactiveFlag = isReadonly
    ? ReactiveFlags.READONLY
    : ReactiveFlags.REACTIVE;
  if (hasOwn(target, reactiveFlag)) {
    // 已经存在当前类型代理，直接返回
    return target[reactiveFlag];
  }
  // 是否为可代理数据类型
  if (!canObserve(target)) {
    return target;
  }
  // 生成代理对象
  const observed = new Proxy(
    target,
    collectionTypes.has(target.constructor) ? collectionHandlers : baseHandlers
  );
  // 在原对象上缓存代理后的对象
  def(target, reactiveFlag, observed);
  return observed;
}
```

::: tip 可代理数据类型
可代理类型包含：源对象上没有`skip`标识、没有冻结的对象以及`Object,Array,Map,Set,WeakMap,WeakSet`其中的一种数据结构。
:::

`createReactiveObject`的主要逻辑可简化成如下几个步骤：

> 1. 过滤不可代理的情况
> 2. 查询可使用缓存的情况
> 3. 生成代理对象
> 4. 缓存代理对象

针对在真正生成代理对象前的处理操作，我们大概可以得出如下结果：

##### 1. reactive 同一个对象多次，只会返回第一次代理的对象

```JavaScript
const o = { num: 1 }
const p1 = reactive(o)
const p2 = reactive(o)
p1 === p2
```

##### 2. reactive 一个响应式对象多次，会得到它本身

```JavaScript
const o = { num: 1 }
const p1 = reactive(o)
const p2 = reactive(p1)
p1 === p2
```

##### 3. reactive 一个 readonly 对象，会直接返回它本身

```JavaScript
const o = { num: 1 }
const p1 = readonly(o)
const p2 = reactive(p1)
p1 === p2
```

`createReactiveObject`代码量不大也没有复杂逻辑，我们主要需要关注的还是`ProxyHandler`部分，我们优先考虑最简单的对象的情况：

```typescript
// reactivity/baseHandlers.ts
export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys,
};
```

::: tip 操作符
`get`: 属性读取捕捉器  
`set`: 属性设置捕捉器  
`deleteProperty`: `delete`操作符捕捉器  
`has`: `in`操作符捕捉器  
`ownKeys`: `Object.getOwnPropertyNames`方法和 `Object.getOwnPropertySymbols` 方法的捕捉器。  
:::
`Vue3`对于对象的五个行为做了代理，我们着重关注`get`和`set`。

- ## 依赖收集-`get`

```typescript
// reactivity/baseHandlers.ts
const get = /*#__PURE__*/ createGetter();

function createGetter(isReadonly = false, shallow = false) {
  return function get(target: object, key: string | symbol, receiver: object) {
    // 1. reactive标识位处理
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly;
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly;
    } else if (
      key === ReactiveFlags.RAW &&
      receiver ===
        (isReadonly
          ? (target as any)[ReactiveFlags.READONLY]
          : (target as any)[ReactiveFlags.REACTIVE])
    ) {
      return target;
    }
    // 2. 处理数组方法key
    const targetIsArray = isArray(target);
    if (targetIsArray && hasOwn(arrayInstrumentations, key)) {
      return Reflect.get(arrayInstrumentations, key, receiver);
    }
    // 3. 取值
    const res = Reflect.get(target, key, receiver);
    // 4. 过滤无需track的key
    if (
      // 访问builtInSymbols内的symbol key或者访问原型和ref内部属性
      isSymbol(key)
        ? builtInSymbols.has(key)
        : key === `__proto__` || key === `__v_isRef`
    ) {
      return res;
    }
    // 5. 依赖收集
    if (!isReadonly) {
      // 非readonly 收集一次类型为get的依赖
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

`createGetter`再次使用了高阶函数的技巧来保存`readonly`和`shallow`的值，
可见在函数化的代码中，高阶函数这类函数式编程的技巧使用的还是很平常的；
函数体内首先针对三个`reactive`标识`key`进行处理，然后就是对数组方法的处理，我们可以详细看一下：

```typescript
const arrayInstrumentations: Record<string, Function> = {};
["includes", "indexOf", "lastIndexOf"].forEach((key) => {
  arrayInstrumentations[key] = function(...args: any[]): any {
    const arr = toRaw(this) as any;
    for (let i = 0, l = (this as any).length; i < l; i++) {
      track(arr, TrackOpTypes.GET, i + "");
    }
    // 首先使用传入的参数执行一遍
    const res = arr[key](...args);
    if (res === -1 || res === false) {
      // 如果失败使用传入参数的原数据来执行一次
      return arr[key](...args.map(toRaw));
    } else {
      return res;
    }
  };
});
```

数组方法的处理，主要针对`includes, indexOf, lastIndexOf`三个对数组整体有依赖的方法，
需要对于每一个元素都进行一次依赖收集，然后再计算求结果并且返回。  
接下来要做的就是取值和依赖收集，在取值前会过滤不需要依赖收集的`key`，得到`key`所对应的值后，
针对非`readonly`的情况进行一次`get`的依赖收集，这里的`track`函数我们稍后详细讲解，先看看后续如何对取出值处理。  
对于当前`key`取出的值仍需要按基本类型、ref 类型和对象来处理。

> 1. 基本值类型直接返回
> 2. `ref`类型，原对象为对象时直接解包`ref`返回，原对象为数组就直接返回`ref`
> 3. 对象，如果是进行`shallow`浅层代理则直接返回，否则返回递归代理的代理对象

- #### `track`依赖收集
  依赖收集是`get`函数中的重中之重，我们需要详细看看`track`函数内部：

```typescript
// reactivity/effect.ts
export function track(target: object, type: TrackOpTypes, key: unknown) {
  // 依赖收集进行的前置条件：
  // 1. 全局收集标识开启
  // 2. 存在激活的副作用
  if (!shouldTrack || activeEffect === undefined) {
    return;
  }
  // 创建依赖收集map target ---> deps ---> effect
  let depsMap = targetMap.get(target);
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map()));
  }
  let dep = depsMap.get(key);
  if (!dep) {
    depsMap.set(key, (dep = new Set()));
  }
  if (!dep.has(activeEffect)) {
    // 依赖收集副作用
    dep.add(activeEffect);
    // 副作用保存依赖
    activeEffect.deps.push(dep);
    // 开发环境触发收集的hooks
    if (__DEV__ && activeEffect.options.onTrack) {
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key,
      });
    }
  }
}
```

`track`的目标很简单，建立当前`key`与当前激活`effect`的依赖关系，源码中使用了一个较为复杂的方式来保存这种依赖关系，
我们通过一张图来捋清楚依赖关系如何建立：  
![get](/vue3-analysis/reactivity/track-dep.jpg)  
通过`target --> key --> dep`的数据结构，完整的存储了对象、键值和副作用的关系，并且通过`Set`来对`effect`去重。  
理清楚了依赖关系的数据结构，`track`函数基本也就理解了；至此`get`我们已经解析完成了，让我们看看`get`函数的整体流程图。

- #### `get`函数整体流程图

  ![get](/vue3-analysis/reactivity/vue3-reactive-get.jpg)

- ## 派发更新-`set`

```typescript
// reactivity/reactive.ts
function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    // 取旧值
    const oldValue = (target as any)[key];
    if (!shallow) {
      // 深度代理情况下，我们需要手动处理属性值为ref的情况，将trigger交给ref来触发
      value = toRaw(value);
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value;
        return true;
      }
    } else {
      // 浅代理模式下，行为与普通对象一致
    }
    // 判断是新增或者修改
    const hadKey = hasOwn(target, key);
    // 设置新值
    const result = Reflect.set(target, key, value, receiver);
    // 如果修改了通过原型查找得到的属性，无需trigger
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        // 新增
        trigger(target, TriggerOpTypes.ADD, key, value);
      } else if (hasChanged(value, oldValue)) {
        // 修改时，需要去除未改变的情况
        // 数组增加元素时，会触发length改变，但在达到length修改的set时
        // 数组已经添加元素成功，取到的oldValue会与value相等，直接过滤掉此次不必要的trigger
        trigger(target, TriggerOpTypes.SET, key, value, oldValue);
      }
    }
    return result;
  };
}
```

`set`函数的主要目标还是修改值并且正确的派发更新，首先在非`shallow`的情况下，
对于`get`阶段针对属性值为`ref`类型时候解包带来的无差别属性访问（可以直接使用`obj.valueRef`而不必使用`obj.valueRef.value`）
进行`set`阶段的兼容，当我们`obj.valueRef = 非ref数据`这样使用时，需要更细致的区分赋值。  
接下来就是完成赋值工作，如果赋值完成后我们的`target`并没有变化，那说明当前设置的`key`来自原型链向上查找无需触发`trigger`。
如果确定是对于`target`上`key`的修改，我们仍需要进行`add`和`set`的区分；因为存在一种场景如下：

```typescript
let arr = reactive([1, 2, 3]);
arr.push(4);
```

当向响应式数组添加元素时，会触发`length`的修改，但是在达到`length`修改的`set`时数组元素已经添加成功，
我们通过`(target as any)[key]`取到的值会与`value`相等，这是一次没有必要的`trigger`所以通过`hasChanged`来过滤一下。  
接下来我们关注到`trigger`函数：

- #### `trigger`派发更新

```typescript
// reactivity/effect.ts
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  const depsMap = targetMap.get(target);
  if (!depsMap) {
    // 从未被当做依赖收集过
    return;
  }

  const effects = new Set<ReactiveEffect>();
  const add = (effectsToAdd: Set<ReactiveEffect> | undefined) => {
    if (effectsToAdd) {
      effectsToAdd.forEach((effect) => {
        // 非tarck模式下，所有副作用都添加
        // track 模式下添加非激活副作用
        if (effect !== activeEffect || !shouldTrack) {
          effects.add(effect);
        } else {
          // 执行中的副作用也有可能更改自身依赖的响应式对象
          // 如果不跳过会导致无限循环
        }
      });
    }
  };

  if (type === TriggerOpTypes.CLEAR) {
    // Map或Set被清空时需要调用整个target对应的所有effect
    depsMap.forEach(add);
  } else if (key === "length" && isArray(target)) {
    // 数组长度变更
    depsMap.forEach((dep, key) => {
      if (key === "length" || key >= (newValue as number)) {
        add(dep);
      }
    });
  } else {
    // 除去以上两种特殊情况，key还存在就直接添加所有有依赖的副作用函数
    if (key !== void 0) {
      add(depsMap.get(key));
    }
    // 针对Map数据类型的操作
    const isAddOrDelete =
      type === TriggerOpTypes.ADD ||
      (type === TriggerOpTypes.DELETE && !isArray(target));
    if (
      isAddOrDelete ||
      (type === TriggerOpTypes.SET && target instanceof Map)
    ) {
      add(depsMap.get(isArray(target) ? "length" : ITERATE_KEY));
    }
    if (isAddOrDelete && target instanceof Map) {
      add(depsMap.get(MAP_KEY_ITERATE_KEY));
    }
  }

  const run = (effect: ReactiveEffect) => {
    // 开发环境下运行 trigger钩子
    if (__DEV__ && effect.options.onTrigger) {
      effect.options.onTrigger({
        effect,
        target,
        key,
        type,
        newValue,
        oldValue,
        oldTarget,
      });
    }
    // 如果存在调度，使用调度来执行effect
    if (effect.options.scheduler) {
      effect.options.scheduler(effect);
    } else {
      effect();
    }
  };

  effects.forEach(run);
}
```

`trigger`函数的逻辑还是比较清晰的，主要有如下步骤：

> 1. 依据不同情况取出副作用函数列表
> 2. 过滤当前激活副作用函数，添加其他副作用函数
> 3. 遍历运行所有被添加副作用函数

`trigger`依赖的还是`track`阶段生成的`targetMap`存储的依赖和副作用函数关系，来查找所有应该被执行的副作用函数来遍历执行。
到现在我们已经清除响应式对象的`track`和`trigger`来源于哪个位置，是如何将依赖于副作用函数关联起来？
又是如何在`set`过后自动执行的；我们现在依旧存疑的就是这个副作用函数`effect`到底是什么？我将会在下一小节聊一聊`effct`，
接下来我们会先看一看`ref`是怎么做的？

## `ref`解析

开篇已经讲过`ref`的出现是为了包装基本类型以实现代理，`API`形态也有所展现，通过`.value`来进行访问和修改，那我们直接看到`ref`函数：

```typescript
// reactivity/ref.ts
export function ref(value?: unknown) {
  return createRef(value);
}

function createRef(rawValue: unknown, shallow = false) {
  // 如果已经是ref 则直接返回
  if (isRef(rawValue)) {
    return rawValue;
  }
  let value = shallow ? rawValue : convert(rawValue);
  const r = {
    // ref 标识
    __v_isRef: true,
    get value() {
      // 依赖收集
      track(r, TrackOpTypes.GET, "value");
      return value;
    },
    set value(newVal) {
      // 产生了变化，则修改
      if (hasChanged(toRaw(newVal), rawValue)) {
        rawValue = newVal;
        value = shallow ? newVal : convert(newVal);
        // 派发更新
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
// 如果是对象则使用reactive代理对象
const convert = <T extends unknown>(val: T): T =>
  isObject(val) ? reactive(val) : val;
```

依旧是以一个高阶函数的形式来创建，因为`ref`也存在`shallowRef`；在看完`reactive`的情况下，`ref`的代码就显得非常简单了；
核心就是使用一个对象来包装传入的值，对于传入的是对象会直接先使用`reactive`代理，`ref`只负责处理来自`.value`的访问和修改。

## 总结

至此我们已经将`reactive`和`ref`两个方法的实现完整解析了一遍，对于依赖收集和派发更新已经有了代码层面的认识；
但是我们通篇都有提到的`effect`副作用函数到底是什么我们并没有讲清楚，所以下一节我们将解析`effect`函数，
来串联起完整的响应式流程。
