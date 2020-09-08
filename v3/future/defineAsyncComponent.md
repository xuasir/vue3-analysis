### 声明异步组件

在大型应用中我们需要将应用切分成小的部分，然后再需要渲染的时候再从服务获取资源来解析，以提供更好的加载体积。
而在`Vue2`中我们大多是时候采用的是`webpack`和`ES6`结合而来的动态导入`() => import()`返回一个`Promise`的方式来创建一个切分，
一般与路由懒加载结合使用。在`Vue3`中官方提供了一个更加完备的异步组件声明方式：`defineAsyncComponent`。

基本使用：

```typescript
const comp = new Promise((resolve) => {
  setTimeout(() => {
    resolve({...});
  }, 200);
});
defineAsyncComponent(comp);
defineAsyncComponent({
  loader: comp
  loadingComponent?: loadingComp
  errorComponent?: errorComp
  delay?: 0
  timeout?: 0
  suspensible?: false
  onError?: (
    error: Error,
    retry: () => void,
    fail: () => void,
    attempts: number
  ) => {}
});
```

可以看到`Vue3`的异步组件能都提供更多的特性比如：延迟时间、超时、发生错误后重新尝试、错误组件、加载组件等，那就让我们看一下内部是如何实现的。

## 类型声明概览

```typescript
// runtime-core/apiAsyncComponent.ts
// promsie resolved 的组件
export type AsyncComponentResolveResult<T = PublicAPIComponent> =
  | T
  | { default: T }; // es modules
// loader 类型
export type AsyncComponentLoader<T = any> = () => Promise<
  AsyncComponentResolveResult<T>
>;

export interface AsyncComponentOptions<T = any> {
  // 异步的组件
  loader: AsyncComponentLoader<T>;
  // 加载中的组件
  loadingComponent?: PublicAPIComponent;
  // 错误时的组件
  errorComponent?: PublicAPIComponent;
  // 延迟加载时长
  delay?: number;
  // 超时 时长
  timeout?: number;
  // 是否使用suspense
  suspensible?: boolean;
  // 出错时的回调
  onError?: (
    error: Error,
    // 重试
    retry: () => void,
    // 失败
    fail: () => void,
    // 尝试加载的次数
    attempts: number
  ) => any;
}
```

## `defineAsyncComponent` 概览

```typescript
// runtime-core/apiAsyncComponent.ts
export function defineAsyncComponent<
  T extends PublicAPIComponent = { new (): ComponentPublicInstance }
>(source: AsyncComponentLoader<T> | AsyncComponentOptions<T>): T {
  // 1. 标准化source，创建相关方法变量
  // 2. 创建load组件promise
  // 3. 调用defineComponent
  return defineComponent({
    __asyncLoader: load,
    name: "AsyncComponentWrapper",
    setup() {
      // 1. 处理异步组件相关状态
      // 2. 返回渲染函数
      return () => {
        // 加载完成
        if (loaded.value && resolvedComp) {
          return createInnerComp(resolvedComp, instance);
        } else if (error.value && errorComponent) {
          // 渲染错误
          return createVNode(errorComponent as Component, {
            error: error.value,
          });
        } else if (loadingComponent && !delayed.value) {
          // 渲染加载中
          return createVNode(loadingComponent as Component);
        }
      };
    },
  }) as any;
}
function createInnerComp(
  comp: Component,
  { vnode: { props, children } }: ComponentInternalInstance
) {
  return createVNode(comp, props, children);
}
// 定义组件
export function defineComponent(options: unknown) {
  return isFunction(options) ? { setup: options, name: options.name } : options;
}
```

我将细节的代码用注释替代，重点关注返回的新组件的基本逻辑；可以看到整个异步组件就是处理异步组件的不同状态（加载中、加载失败、加载成功）
然后通过`render`函数来进行条件渲染，`createInnerComp`做的只是将`props`和`children`透传给内部的组件；
大体的思路我们理解了，再具体看一下细节实现。

## 1. 标准化 source，创建相关方法变量

`defineAsyncComponent`可以接受`options`和`Promise`的异步组件两种类型的参数，如果接受的是`promise`函数会直接转成`options`；

```typescript
// 转为options
if (isFunction(source)) {
  source = { loader: source };
}
```

转换完成后会定义一系列的变量和方法:

```typescript
const {
  loader,
  loadingComponent: loadingComponent,
  errorComponent: errorComponent,
  delay = 200,
  // 超时为undefined时永不超时
  timeout,
  suspensible = true,
  onError: userOnError,
} = source;
// 当前进行的异步组件请求promise
let pendingRequest: Promise<Component> | null = null;
let resolvedComp: Component | undefined;
// 重新尝试
let retries = 0;
const retry = () => {
  retries++;
  // 清空重新加载
  pendingRequest = null;
  return load();
};
```

首先做的是从`source`去除相关的选项，我们注意到异步组件的加载会有一个`200ms`的默认延迟，并且默认情况下是会开启`suspense`；
`retry`的时候会清空当前进行的异步组件请求`promise`函数缓存，并且累计`retry`次数最终执行`load`函数，我们看一下`load`函数的实现。

## 2. 创建`load`组件的`promise`函数

```typescript
const load = (): Promise<Component> => {
  // 本次load调用的异步组件请求promise函数
  let thisRequest: Promise<Component>;
  return (
    // 存在正在进行的异步组件请求promise函数则直接返回
    pendingRequest ||
    (thisRequest = pendingRequest = loader()
      .catch((err) => {
        // 异常处理
        // 创建错误信息
        err = err instanceof Error ? err : new Error(String(err));
        if (userOnError) {
          // 存在用户的错误处理函数
          return new Promise((resolve, reject) => {
            const userRetry = () => resolve(retry());
            const userFail = () => reject(err);
            // 调用用户错误处理函数
            userOnError(err, userRetry, userFail, retries + 1);
          });
        } else {
          throw err;
        }
      })
      .then((comp: any) => {
        // 异步组件返回处理
        if (thisRequest !== pendingRequest && pendingRequest) {
          // 本次异步组件请求和正在进行的异步组件请求不一致，且存在正在进行的异步组件请求，返回正在进行的异步组件请求
          return pendingRequest;
        }
        if (__DEV__ && !comp) {
          warn(
            `Async component loader resolved to undefined. ` +
              `If you are using retry(), make sure to return its return value.`
          );
        }
        // 解析 esm 格式
        if (
          comp &&
          (comp.__esModule || comp[Symbol.toStringTag] === "Module")
        ) {
          comp = comp.default;
        }
        if (__DEV__ && comp && !isObject(comp) && !isFunction(comp)) {
          throw new Error(`Invalid async component load result: ${comp}`);
        }
        // 缓存请求成功的组件
        resolvedComp = comp;
        return comp;
      }))
  );
};
```

`load`作为执行获取组件的`loader`函数的方法，对请求的错误和成功分别进行了处理；
由于组件的使用在整个项目中可能是多例的，需要一个方式来保证不重复请求使用缓存，
这里处理方式就是：

利用多例的组件共享了`defineAsyncComponent`的函数作用域，
通过`pendingRequest`来保存正在进行的异步组件请求，`resolvedComp`保存请求返回的组件，
在`load`函数内通过闭包变量`thisRequest`来保存此次调用`load`的异步组件请求`promise`函数，
并且在返回请求函数时优先返回`pendingRequest`，来实现异步组件的多例但是异步组件请求的单例。

- #### 错误处理

  在`catch`会先将错误信息处理为`Error`的实例，用户未传递错误处理函数时直接将错误`throw`出去；
  用户传递了错误处理函数则返回一个`promise`通过将`resolve`和`reject`移交给用户传递的错误处理函数内部来调用，
  达到移交处理权的目的，当用户调用`userRetry`后`promise`会重新返回一个`load`组件的`promise`这样就达到了重新加载的目的，
  而用户调用`userFail`会`reject`当前的`promise`，异步组件进入异常状态。

- #### 成功处理

  成功处理中最优先的就是`pendingRequest`单例的问题，当本次异步组件请求和正在进行的异步组件请求不一致，
  且存在正在进行的异步组件请求，直接返回正在进行的异步组件请求。然后会对`resolve`的结果进行`esm`的兼容处理以及组件合法性校验，
  最后进行组件缓存和返回。

## 3. 创建异步组件

至此我们都是在处理加载组件相关`load`函数和变量，未涉及到异步组件的创建，接下来我们就看看是如处理组件加载状态的。

```typescript
defineComponent({
  __asyncLoader: load,
  name: "AsyncComponentWrapper",
  setup() {
    const instance = currentInstance!;
    if (resolvedComp) {
      // 已经resolved 直接透传props children
      return () => createInnerComp(resolvedComp!, instance);
    }
    // 错误处理函数
    const onError = (err: Error) => {
      pendingRequest = null;
      handleError(err, instance, ErrorCodes.ASYNC_COMPONENT_LOADER);
    };
    // 返回load promise移交给suspense接管
    if (
      (__FEATURE_SUSPENSE__ && suspensible && instance.suspense) ||
      (__NODE_JS__ && isInSSRComponentSetup)
    ) {
      return load()
        .then((comp) => {
          return () => createInnerComp(comp, instance);
        })
        .catch((err) => {
          onError(err);
          return () =>
            errorComponent
              ? createVNode(errorComponent as Component, { error: err })
              : null;
        });
    }
    // 是否加载完毕
    const loaded = ref(false);
    // 错误信息
    const error = ref();
    // 是否延迟加载
    const delayed = ref(!!delay);
    // 设置延迟
    if (delay) {
      setTimeout(() => {
        delayed.value = false;
      }, delay);
    }
    // 设置超时
    if (timeout != null) {
      setTimeout(() => {
        if (!loaded.value) {
          // 超过时间会直接抛出超时错误
          const err = new Error(
            `Async component timed out after ${timeout}ms.`
          );
          onError(err);
          error.value = err;
        }
      }, timeout);
    }
    // 加载组件
    load()
      .then(() => {
        loaded.value = true;
      })
      .catch((err) => {
        onError(err);
        error.value = err;
      });
    // 普通异步组件 被当做 render函数处理
    return () => {
      // 加载完成
      if (loaded.value && resolvedComp) {
        return createInnerComp(resolvedComp, instance);
      } else if (error.value && errorComponent) {
        // 渲染错误
        return createVNode(errorComponent as Component, {
          error: error.value,
        });
      } else if (loadingComponent && !delayed.value) {
        // 渲染加载中
        return createVNode(loadingComponent as Component);
      }
    };
  },
}) as any;
```

异步组件的定义整体来说还是比较简单的，通过简单注释就能理解；值得注意的是如果异步组件已经加载完毕会优先使用`resolvedComp`缓存的组件。

## 总结

异步组件的创建整体逻辑还是十分清晰的，依赖于`promise`来实现异步加载；在错误处理的部分，
返回新的`promise`通过`resolve`和`reject`来移交组件加载的下一步决定权，是值得我们学习的技巧。
