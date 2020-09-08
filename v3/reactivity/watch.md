### 侦听器

计算属性虽然能胜任大多数场景下的需求，但是在一些场景下我们可能需要的是侦听某个响应式的数据；
在`Vue2`中为我们提供了`watch options`和`$watch`，`Vue3`中依旧保留了`watch API`并且扩展了一个`watchEffect`，
我们先看看在`Vue3`中他们的`API`形态。

```typescript
const num = ref(0);
const obj = reactive({ num: 0 });
// 监听ref
watch(num, (newVal, olVal, onInvalidate) => {});
// 监听reactive 默认为深度监听
watch(obj, (newVal, olVal, onInvalidate) => {});
// 更具体的监听某个值
watch(
  () => obj.num,
  (newVal, olVal, onInvalidate) => {}
);
// 监听多个响应式数据
watch([num, obj], ([newNum, newObj], [oldNum, oldObj], onInvalidate) => {});
```

相较`Vue2`在监听上更加强大，能够同时监听多个响应式数据，而且`API`是以函数的形态对外暴露的也属于`composition API`的一部分，
这就是为什么`watchAPI`在`runtime-core`中实现却放在响应式篇章来讲解的原因；
`watchAPI`的背后依附于`effect`函数就让我们看看是如何通过`effect`来实现侦听器的。

## 本篇目标

1. 理解`watch`和`watchEffect`的实现原理

## `watch API`概览

- ##### `watch options`类型声明

```typescript
// runtime-core/apiWatch.ts
// watchEffect 配置选项
export interface WatchOptionsBase {
  // 调度模式
  flush?: "pre" | "post" | "sync";
  onTrack?: ReactiveEffectOptions["onTrack"];
  onTrigger?: ReactiveEffectOptions["onTrigger"];
}
// watch 配置选项
export interface WatchOptions<Immediate = boolean> extends WatchOptionsBase {
  // 立即执行
  immediate?: Immediate;
  // 深度监听
  deep?: boolean;
}
```

- ##### `watch callback`类型声明

```typescript
// runtime-core/apitWatch.ts
export type WatchCallback<V = any, OV = any> = (
  value: V,
  oldValue: OV,
  onInvalidate: InvalidateCbRegistrator
) => any;
```

## 完整带注释代码

::: details 点击查看 watchAPI 完整带注释代码

```typescript
// runtime-core/apitWatch.ts
export function watch<T = any>(
  source: WatchSource<T> | WatchSource<T>[],
  cb: WatchCallback<T>,
  options?: WatchOptions
): WatchStopHandle {
  return doWatch(source, cb, options);
}

function doWatch(
  source: WatchSource | WatchSource[] | WatchEffect,
  cb: WatchCallback | null,
  { immediate, deep, flush, onTrack, onTrigger }: WatchOptions = EMPTY_OBJ,
  instance = currentInstance
): WatchStopHandle {
  // 警示函数
  const warnInvalidSource = (s: unknown) => {
    warn(
      `Invalid watch source: `,
      s,
      `A watch source can only be a getter/effect function, a ref, ` +
        `a reactive object, or an array of these types.`
    );
  };
  // 1. 处理getter ref reactive-obj func
  let getter: () => any;
  if (isRef(source)) {
    getter = () => source.value;
  } else if (isReactive(source)) {
    getter = () => source;
    // 默认深度监听
    deep = true;
  } else if (isArray(source)) {
    getter = () =>
      source.map((s) => {
        if (isRef(s)) {
          return s.value;
        } else if (isReactive(s)) {
          return traverse(s);
        } else if (isFunction(s)) {
          return callWithErrorHandling(s, instance, ErrorCodes.WATCH_GETTER);
        } else {
          __DEV__ && warnInvalidSource(s);
        }
      });
  } else if (isFunction(source)) {
    if (cb) {
      // watch
      getter = () =>
        callWithErrorHandling(source, instance, ErrorCodes.WATCH_GETTER);
    } else {
      // watchEffect
      getter = () => {
        if (instance && instance.isUnmounted) {
          return;
        }
        if (cleanup) {
          cleanup();
        }
        return callWithErrorHandling(
          source,
          instance,
          ErrorCodes.WATCH_CALLBACK,
          [onInvalidate]
        );
      };
    }
  } else {
    getter = NOOP;
    __DEV__ && warnInvalidSource(source);
  }
  // 深度遍历traverse整体reactive-obj
  if (cb && deep) {
    const baseGetter = getter;
    getter = () => traverse(baseGetter());
  }
  // 2. 用来存储清除函数
  let cleanup: () => void;
  // watch函数中注册清除函数行为的hook
  const onInvalidate: InvalidateCbRegistrator = (fn: () => void) => {
    cleanup = runner.options.onStop = () => {
      callWithErrorHandling(fn, instance, ErrorCodes.WATCH_CLEANUP);
    };
  };
  // 3. 生成执行cb的函数
  let oldValue = isArray(source) ? [] : INITIAL_WATCHER_VALUE;
  const job = () => {
    if (!runner.active) {
      return;
    }
    if (cb) {
      // watch(source, cb)
      // 求新值
      const newValue = runner();
      // 深度监听直接执行cb
      if (deep || hasChanged(newValue, oldValue)) {
        // 清除副作用
        if (cleanup) {
          cleanup();
        }
        // 执行cb
        callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
          newValue,
          // pass undefined as the old value when it's changed for the first time
          oldValue === INITIAL_WATCHER_VALUE ? undefined : oldValue,
          onInvalidate,
        ]);
        oldValue = newValue;
      }
    } else {
      // watchEffect
      runner();
    }
  };

  let scheduler: (job: () => any) => void;
  // 4. 生成调度器
  if (flush === "sync") {
    // 同步执行
    scheduler = job;
  } else if (flush === "pre") {
    // 将id设置为自小，在组件更新前执行
    job.id = -1;
    scheduler = () => {
      if (!instance || instance.isMounted) {
        queueJob(job);
      } else {
        // pre 使用必须在组件挂载完成的情况下，否则直接同步执行
        job();
      }
    };
  } else {
    // 更新后执行
    scheduler = () => queuePostRenderEffect(job, instance && instance.suspense);
  }
  // 5. 创建副作用函数
  const runner = effect(getter, {
    lazy: true,
    onTrack,
    onTrigger,
    scheduler,
  });
  // 6. 将watch创建的effect关联到组件实例上，方便组件卸载时停止
  recordInstanceBoundEffect(runner);

  // 7. 初始化执行
  if (cb) {
    if (immediate) {
      job();
    } else {
      oldValue = runner();
    }
  } else {
    runner();
  }
  // 8. 返回 stop
  return () => {
    stop(runner);
    if (instance) {
      remove(instance.effects!, runner);
    }
  };
}
```

:::

`watch`和`watchEffect`的实现都内聚在`doWatch`中，接下来我们将按步骤详细探讨 `doWatch`的实现。

## 处理`source`参数

`watch`函数的`source`参数有多个形态，我们的目标是通过`source`的不同传参来构建`getter`函数能访问到`source`都所有响应式数据，
所以需要标准化同时也需要检测参数，来确定是`watch`调用还是`watchEffect`；
我们先看一下`source`的类型声明：

```typescript
export type WatchSource<T = any> = Ref<T> | ComputedRef<T> | (() => T);
source: WatchSource<T> | (WatchSource<T> | object)[] | object
```

我们基本可以确定在`source`的处理中需要针对`ref`、`reactive`、`function`和`array`这四种类型来进行不同处理，
我们依次看一下是具体的处理方式：

##### 1. `ref` 类型

```typescript
if (isRef(source)) {
  getter = () => source.value;
}
```

遇到`ref`类型会直接创建一个访问到`ref.value`的`getter`函数。

##### 2. `reactive`类型

```typescript
if (isReactive(source)) {
  getter = () => source;
  // 默认深度监听
  deep = true;
}
```

如果`source`是一个`reactive`对象，会默认为深度监听即使配置了`deep: false`，因为我们并没有指定一个具体在`source`上的属性，
`watch`无法确定我们需要监听的内容只能深度监听`source`。

#### 3. `function`类型

```typescript
if (isFunction(source)) {
  if (cb) {
    // watch
    getter = () =>
      callWithErrorHandling(source, instance, ErrorCodes.WATCH_GETTER);
  } else {
    // watchEffect
    getter = () => {
      // 组件卸载了直接返回
      if (instance && instance.isUnmounted) {
        return;
      }
      // 清除来自effect的副作用
      if (cleanup) {
        cleanup();
      }
      // 执effect并传入onInvalidate作为参数
      return callWithErrorHandling(
        source,
        instance,
        ErrorCodes.WATCH_CALLBACK,
        [onInvalidate]
      );
    };
  }
}
```

当`source`为函数时，会出现`watch`和`watchEffect`的分支，这主要依附于`cb`是否传递，因为`watch`时必须传递一个回调的；
`watch`的情况会直接创建一个执行`source`的`getter`；`watchEffect`的情况也会创建一个包裹函数`getter`来执行`source`，
但是会在执行`source`检测`watchEffect`所在的组件是否已卸载，还需要清除来自上一次`source`运行产生的副作用。

##### 4. `array`类型

```typescript
if (isArray(source)) {
  getter = () =>
    source.map((s) => {
      if (isRef(s)) {
        return s.value;
      } else if (isReactive(s)) {
        return traverse(s);
      } else if (isFunction(s)) {
        return callWithErrorHandling(s, instance, ErrorCodes.WATCH_GETTER);
      } else {
        __DEV__ && warnInvalidSource(s);
      }
    });
}
```

当`source`为数组时，会创建一个`getter`来遍历访问到每个项目，而每个数组项将不会再是数组仅需处理剩下的三种情况，
我们注意到数组项目为`reactive`对象的时候会进行一次`traverse`我们紧接着来详细看一下。

##### 5. `traverse`

```typescript
// 深度遍历traverse整体reactive-obj
if (cb && deep) {
  const baseGetter = getter;
  getter = () => traverse(baseGetter());
}

function traverse(value: unknown, seen: Set<unknown> = new Set()) {
  // 非object 通过缓存提升性能
  if (!isObject(value) || seen.has(value)) {
    return value;
  }
  seen.add(value);
  if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      traverse(value[i], seen);
    }
  } else if (value instanceof Map) {
    value.forEach((v, key) => {
      // to register mutation dep for existing keys
      traverse(value.get(key), seen);
    });
  } else if (value instanceof Set) {
    value.forEach((v) => {
      traverse(v, seen);
    });
  } else {
    for (const key in value) {
      traverse(value[key], seen);
    }
  }
  return value;
}
```

可以看到`traverse`会针对不同类型来递归访问每个属性。

## 创建副作用函数

```typescript
// 创建副作用函数
const runner = effect(getter, {
  lazy: true,
  onTrack,
  onTrigger,
  scheduler,
});
// 将watch创建的effect关联到组件实例上，方便组件卸载时停止
recordInstanceBoundEffect(runner);
```

`watch`或者`watchEffect`内部需要做的还是创建一个包裹`getter`的副作用函数来追踪`getter`访问到的响应式数据变化以自动执行；
这对于`effect`的处理和`computed`的内部处理非常相似，将`scheduler`和`runner`分离，通过`trigger`触发的执行交接到`scheduler`；
`getter`的重新执行依旧需要手动调用`runner`，我们接下来直接看看`scheduler`是如何实现的？

## 创建`scheduler`

刚刚分析到通过`trigger`触发的执行会交到`scheduler`来处理，可想而知`scheduler`中一定是需要针对`watch`或`watchEffect`做不同处理的。

```typescript
// 用来存储清除函数
let cleanup: () => void;
// watch函数中注册清除函数行为的hook
const onInvalidate: InvalidateCbRegistrator = (fn: () => void) => {
  cleanup = runner.options.onStop = () => {
    callWithErrorHandling(fn, instance, ErrorCodes.WATCH_CLEANUP);
  };
};
// 生成执行cb的函数
let oldValue = isArray(source) ? [] : INITIAL_WATCHER_VALUE;
const job = () => {
  if (!runner.active) {
    return;
  }
  if (cb) {
    // watch(source, cb)
    // 求新值
    const newValue = runner();
    // 深度监听直接执行cb
    if (deep || hasChanged(newValue, oldValue)) {
      // 清除副作用
      if (cleanup) {
        cleanup();
      }
      // 执行cb
      callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
        newValue,
        oldValue === INITIAL_WATCHER_VALUE ? undefined : oldValue,
        onInvalidate,
      ]);
      oldValue = newValue;
    }
  } else {
    // watchEffect
    runner();
  }
};
let scheduler: (job: () => any) => void;
// 生成调度器
if (flush === "sync") {
  // 同步执行
  scheduler = job;
} else if (flush === "pre") {
  // 将id设置为自小，在组件更新前执行
  job.id = -1;
  scheduler = () => {
    if (!instance || instance.isMounted) {
      queueJob(job);
    } else {
      job();
    }
  };
} else {
  // 更新后执行
  scheduler = () => queuePostRenderEffect(job, instance && instance.suspense);
}
```

看完代码发现`scheduler`并不是直接进行逻辑处理，因为`watch options`能传递`flush`来决定调度的时机，
有三种可选配置项:

> `sync`：同步执行  
> `pre`：组件更新之前执行  
> `post`：组件更新后执行

真实的`cb`和`runner`执行发生在`job`中，整体逻辑十分简单；`watch`的情况先通过`runner`求新值再执行`cb`；
`watchEffect`的情况则直接执行`runner`；同时为了在每次重新执行`runner`前清除`cb`中产生的副作用，
将提供一个`cleanup`在`doWatch`内部保存清除副作用函数以供`job`调用`runner`前清除副作用；
提供一个`onInvalidate`作为参数来传递用户编写`cb`时需要清除的副作用。

## 初始化执行

```typescript
if (cb) {
  // watch
  if (immediate) {
    // 立即执行
    job();
  } else {
    // 求一次值
    oldValue = runner();
  }
} else {
  // watchEffect
  runner();
}
```

初始化执行在`watchEffect`的时候时必须的，`watch`的情况取决于`immediate`的配置。

## 整体流程图

![watch](/vue3-analysis/reactivity/watch.jpg)

## 总结

这就是`watchAPI`的实现方式，依旧依赖于`effect`，和`computed`采用了相同的处理方式将`scheduler`和`runner`分离，
更加精确的控制执行时机，以在再次执行副作用函数之前能做更多操作，实现类似延迟求值和`watch`的`cb`。
