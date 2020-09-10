### 生命周期

我们在前面的章节讨论了组件的挂载更新流程，而`Vue`也为我们提供了一系列的钩子函数来在组件的不同生命周期做一些事情提供入口。
在`Vue3`中已经将`beforeCreate`和`created`用`setup`来替代了，并且新增了两个用来调试`render`的生命周期，如下所示：

```
beforeCreate --> setup;
created --> setup;
beforeMount --> onBeforeMount;
mounted --> onMounted;
beforeUpdate --> onBeforeUpdate;
updated --> onUpdated;
beforeDestory --> onBeforeUnmount;
destoryed --> onUnmounted;
activated --> onActivated;
deactivated --> onDeactivated;
errorCaptured --> onErrorCaptured;
onRenderTracked;
onRenderTriggered;
```

## 本篇目标

1. 理解钩子函数的注册和调用
2. 了解钩子函数的调用时机

## 钩子函数的注册

在`Vue3`中生命周期钩子函数不再使用`options`的形式使用而是在`setup`选项中，以函数的形式来调用类似：

```typescript
const comp = defineComponent({
  setup() {
    onMounted(() => console.log("mounted"));
    onUpdated(() => console.log("updated"));
  },
});
```

通过调用`onMounted`函数就将生命周期函数注册上了，那我们来看一看`onMounted`是如何实现的。

```typescript
// runtime-core/apiLifecycle.ts
export const onBeforeMount = createHook(LifecycleHooks.BEFORE_MOUNT);
export const onMounted = createHook(LifecycleHooks.MOUNTED);
export const onBeforeUpdate = createHook(LifecycleHooks.BEFORE_UPDATE);
export const onUpdated = createHook(LifecycleHooks.UPDATED);
export const onBeforeUnmount = createHook(LifecycleHooks.BEFORE_UNMOUNT);
export const onUnmounted = createHook(LifecycleHooks.UNMOUNTED);

export type DebuggerHook = (e: DebuggerEvent) => void;
export const onRenderTriggered = createHook<DebuggerHook>(
  LifecycleHooks.RENDER_TRIGGERED
);
export const onRenderTracked = createHook<DebuggerHook>(
  LifecycleHooks.RENDER_TRACKED
);

export type ErrorCapturedHook = (
  err: unknown,
  instance: ComponentPublicInstance | null,
  info: string
) => boolean | void;

export const onErrorCaptured = (
  hook: ErrorCapturedHook,
  target: ComponentInternalInstance | null = currentInstance
) => {
  injectHook(LifecycleHooks.ERROR_CAPTURED, hook, target);
};
```

生命周期的注册函数大多数是由`createHook`来创建的，`onErrorCaptured`的创建比较特殊使用了`injectHook`那我们来看一下这两个函数：

```typescript
// runtime-core/apiLifecycle.ts
export const createHook = <T extends Function = () => any>(
  lifecycle: LifecycleHooks
) => (hook: T, target: ComponentInternalInstance | null = currentInstance) =>
  injectHook(lifecycle, hook, target);

export function injectHook(
  type: LifecycleHooks,
  hook: Function & { __weh?: Function },
  target: ComponentInternalInstance | null = currentInstance,
  // 是否放置在hooks队列首部
  prepend: boolean = false
) {
  if (target) {
    // 取出hooks队列
    const hooks = target[type] || (target[type] = []);
    const wrappedHook =
      hook.__weh ||
      (hook.__weh = (...args: unknown[]) => {
        if (target.isUnmounted) {
          // 组件已经卸载 不执行
          return;
        }
        // 禁用 依赖收集
        pauseTracking();
        // 设置当前组件实例
        setCurrentInstance(target);
        // 调用钩子函数
        const res = callWithAsyncErrorHandling(hook, target, type, args);
        // 重新设置组件实例和 依赖收集状态
        setCurrentInstance(null);
        resetTracking();
        return res;
      });
    if (prepend) {
      // 放置在队首 提前执行
      hooks.unshift(wrappedHook);
    } else {
      // 正常情况 放置在队尾
      hooks.push(wrappedHook);
    }
  } else if (__DEV__) {
    // 不存在组件实例时 开发环境下要进行警告
    const apiName = `on${capitalize(
      ErrorTypeStrings[type].replace(/ hook$/, "")
    )}`;
    warn(
      `${apiName} is called when there is no active component instance to be ` +
        `associated with. ` +
        `Lifecycle injection APIs can only be used during execution of setup().` +
        (__FEATURE_SUSPENSE__
          ? ` If you are using async setup(), make sure to register lifecycle ` +
            `hooks before the first await statement.`
          : ``)
    );
  }
}
```

可以看到`createHook`内部还是调用了`injectHook`但是为什么`onErrorCaptured`不使用`createHook`来创建呢？
因为`createHook`内部还有对`SSR`下的处理我们省略了，`onErrorCaptured`在`SSR`下是可以使用的，所以需要单独来创建。
不难发现`createHook`内部只是利用了高阶函数来做一个参数保留就调用了`injectHook`，而`injectHook`才是真正的创建`wrappedHook`函数的位置，
这个包裹函数做了一些在执行`hooks`函数前后要进行的依赖收集状态的处理、组件实例的设置，然后就将包裹函数推入了实例上保存；
`keep-alive`相关的两个钩子函数会放在`keepAlive`组件的章节讲解。

## 钩子函数的调用

生命周期钩子函数是通过`invokeArrayFns`来调用的，我们先看一下实现：

```typescript
// shared/index.ts
export const invokeArrayFns = (fns: Function[], arg?: any) => {
  for (let i = 0; i < fns.length; i++) {
    fns[i](arg);
  }
};
```

仅仅是`hooks`队列遍历执行一遍，有了这个基础我们再来看生命周期钩子函数的执行时机。

#### `onBeforeMount`、`onMounted`、`onBeforeUpdate`和`onUpdated`

```typescript
const setupRenderEffect: SetupRenderEffectFn = (
  instance,
  initialVNode,
  container,
  anchor,
  parentSuspense,
  isSVG,
  optimized
) => {
  // create reactive effect for rendering
  // 创建执行带副作用的渲染函数并保存在update属性上
  instance.update = effect(function componentEffect() {
    if (!instance.isMounted) {
      // 挂载
      // 渲染出组件子树
      // ...
      // beforeMount hook
      if (bm) {
        invokeArrayFns(bm);
      }
      // patch子树
      // ...
      // mounted hook
      if (m) {
        queuePostRenderEffect(m, parentSuspense);
      }
    } else {
      // 更新
      // 渲染出新组件子树
      // ...
      // beforeUpdate hook
      if (bu) {
        invokeArrayFns(bu);
      }
      // patch新旧子树
      // ...
      // updated hook
      if (u) {
        queuePostRenderEffect(u, parentSuspense);
      }
    }
  }, prodEffectOptions);
};
```

`onBeforeMount`会在渲染完组件子树后执行，而`onMounted`则是在组件挂载完成后的任务队列中执行；
而`onBeforeUpdate`会在渲染完成新的组件子树后执行，`onUpdated`则是在组件更新完成后的任务队列中执行。

#### `onBeforeUnmount`和`onUnmounted`

```typescript
const unmountComponent = (
  instance: ComponentInternalInstance,
  parentSuspense: SuspenseBoundary | null,
  doRemove?: boolean
) => {
  // beforeUnmount hook
  if (bum) {
    invokeArrayFns(bum);
  }
  // 停止组件相关副作用
  // unmounted hook
  if (um) {
    queuePostRenderEffect(um, parentSuspense);
  }
  // 设置组件已卸载标识
};
```

可以看到`onBeforeUnmount`的执行会在组件卸载的最开始位置，在进行完组件的副作用停止工作后，
向组件卸载完成后的任务队列推入`onUnmounted`钩子函数。

#### `onRenderTracked`和`onRenderTriggered`

这两个钩子函数比较特殊仅仅会在开发环境下生效，两个钩子函数被当做`effect`的配置传递到`effect`函数中：

```typescript
function createDevEffectOptions(
  instance: ComponentInternalInstance
): ReactiveEffectOptions {
  return {
    scheduler: queueJob,
    onTrack: instance.rtc ? (e) => invokeArrayFns(instance.rtc!, e) : void 0,
    onTrigger: instance.rtg ? (e) => invokeArrayFns(instance.rtg!, e) : void 0,
  };
}
```

在组件的带副作用渲染函数发生依赖收集和派发更新时会分别调用`onRenderTracked`和`onRenderTriggered`两个钩子。

#### `onErrorCaptured`

在`Vue3`的执行过程中一些可能会出现错误的函数执行会采用一些`errorHandling`函数来包裹执行，
其中对于错误的处理会使用`handleError`函数来处理，我们看一下`Vue3`执行函数出现的错误是如何被处理的。

```typescript
export function handleError(
  err: unknown,
  instance: ComponentInternalInstance | null,
  type: ErrorTypes
) {
  const contextVNode = instance ? instance.vnode : null;
  if (instance) {
    let cur = instance.parent;
    // 暴露render代理实例，和2.x保持一致
    const exposedInstance = instance.proxy;
    // 开发环境需要更加详细的错误类型信息
    const errorInfo = __DEV__ ? ErrorTypeStrings[type] : type;
    // 从当前发生异常组件的父组件一直向上冒泡执行errorCapturedHooks
    while (cur) {
      const errorCapturedHooks = cur.ec;
      if (errorCapturedHooks) {
        for (let i = 0; i < errorCapturedHooks.length; i++) {
          if (errorCapturedHooks[i](err, exposedInstance, errorInfo)) {
            return;
          }
        }
      }
      cur = cur.parent;
    }
    // app级别的处理
    const appErrorHandler = instance.appContext.config.errorHandler;
    if (appErrorHandler) {
      callWithErrorHandling(
        appErrorHandler,
        null,
        ErrorCodes.APP_ERROR_HANDLER,
        [err, exposedInstance, errorInfo]
      );
      return;
    }
  }
  // 警告日志
  logError(err, type, contextVNode);
}
```

对于错误的处理主要分为三个部分，组件级别的错误处理函数、`app`级别的处理函数以及警告日志。
而我们的`onErrorCaptured`错误处理钩子函数就发生组件级别的处理中，
`Vue3`会在发生异常实例的父组件开始一直向上冒泡执行错误钩子函数，
当然如果`onErrorCaptured`返回`true`来表示我这一层次处理完成就足够了就可以阻止错误的继续冒泡。

## 总结

每个生命周期函数执行的时机都对应着不同需求情况，这也是为我们组件编程提供了一个切面；我们现在已经深入了解了每个生命周期的执行时机，
在开发中应该选取合适的时机来做处理，比如在`onMounted`才能操作`Dom`等等需要注意的点、组件级别的错误处理又应该如何做；
这些都是我们深度解析生命周期函数的原因。
