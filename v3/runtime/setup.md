### setup 选项

在`Vue3`中推出了一个新的`setup`选项，来承载`composition API`同时也替代了`beforeCreated`和`created`两个生命周期选项；
`setup`仅在组件启动的时候执行一次，来确定组件所有与视图相关联系的数据、行为和作用；在`Vue3`中组件已经被简化成如下形态：

```JavaScript
const setup = (props) => {
  // 使用某些状态、行为
  const state = reactive({
    count: 0,
    double: computed(() => state.count * 2),
  })

  function increment() {
    state.count++
  }
  return {
    // 行为与状态
    state,
    increment,
  }
}

const renderContext = setup(props)

watchEffect(() => {
  renderTemplate(
    `<button @click="increment">
      Count is: {{ state.count }}, double is: {{ state.double }}
    </button>`,
    renderContext
  )
})
```

而`Vue3`的组件系统正是帮我们将`setup()`、渲染模板和侦听器的工作整合在内部；今天我们要解析的就是在组件系统内部`setup`是如何被处理的。

## 本篇目的

1. 了解`setup`的执行过程

## 解析

我们之前在谈到`mount`流程解析组件挂载时，遇到了创建组件的流程：

```ts
// runtime-core/renderer.ts
const mountComponent: MountComponentFn = (
  initialVNode,
  container,
  anchor,
  parentComponent,
  parentSuspense,
  isSVG,
  optimized
) => {
  // 创建组件实例
  const instance: ComponentInternalInstance = (initialVNode.component = createComponentInstance(
    initialVNode,
    parentComponent,
    parentSuspense
  ));
  // 启动组件
  setupComponent(instance);
  // 启动带副作用的render函数
  setupRenderEffect(
    instance,
    initialVNode,
    container,
    anchor,
    parentSuspense,
    isSVG,
    optimized
  );
};
```

这和我们上面所说的`Vue3`组件系统所做的事情基本一致，而`setup`的处理就发生在`setupComponent`中，我们直接看到该函数内部：

```JavaScript
// runtime-core/component.ts
export function setupComponent(
  instance: ComponentInternalInstance,
  isSSR = false
) {
  const { props, children, shapeFlag } = instance.vnode
  const isStateful = shapeFlag & ShapeFlags.STATEFUL_COMPONENT
  // 初始化props
  initProps(instance, props, isStateful, isSSR)
  // 初始化插槽
  initSlots(instance, children)
  // 执行 setup
  const setupResult = isStateful
    ? setupStatefulComponent(instance, isSSR)
    : undefined
  // 返回setup执行结果
  return setupResult
}
```

::: tip 启动组件

1. 初始化 props
2. 初始化插槽
3. 执行 setup 函数  
   :::
   启动一个组件基本上就是以上几个步骤，而针对存在状态的组件，会执行`setup函数`。

## 执行`setup`

针对存在状态的组件会调用`setupStatefulComponent`来初始化组件状态，我们直接看到同文件下`setupStatefulComponent`函数：

```JavaScript
function setupStatefulComponent(
  instance: ComponentInternalInstance,
  isSSR: boolean
) {
  const Component = instance.type as ComponentOptions

  // 0. 创建代理访问位置缓存
  instance.accessCache = {}
  // 1. 创建一个组件的渲染上下文代理，相当于vue2的this
  instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers)

  // 2. 调用 setup()
  const { setup } = Component
  if (setup) {
    // 按需创建setup第二个参数 上下文
    const setupContext = (instance.setupContext =
      setup.length > 1 ? createSetupContext(instance) : null)
    // 设置当前组件实例
    currentInstance = instance
    pauseTracking()
    // 调用setup
    const setupResult = callWithErrorHandling(
      setup,
      instance,
      ErrorCodes.SETUP_FUNCTION,
      [__DEV__ ? shallowReadonly(instance.props) : instance.props, setupContext]
    )
    resetTracking()
    currentInstance = null
    // 处理setup执行结果
    if (isPromise(setupResult)) {
      if (isSSR) {
        // ssr下，等待promise返回再处理setup执行结果
        return setupResult.then((resolvedResult: unknown) => {
          handleSetupResult(instance, resolvedResult, isSSR)
        })
      } else if (__FEATURE_SUSPENSE__) {
        // client端 等待再次进入
        // 保存异步依赖
        instance.asyncDep = setupResult
      } else if (__DEV__) {
        // 开发环境下抛出警告，不支持异步的setup函数
        warn(
          `setup() returned a Promise, but the version of Vue you are using ` +
            `does not support it yet.`
        )
      }
    } else {
      // 更详细的处理setup执行结果
      handleSetupResult(instance, setupResult, isSSR)
    }
  } else {
    // 完成组件启动的后续工作
    finishComponentSetup(instance, isSSR)
  }
}
```

::: tip 执行 setup 流程

1. 创建渲染上下文
2. 执行 setup 函数
3. 处理 setup 执行结果
4. 组件启动后续工作
   :::
   我们按照 setup 执行流程中的三个步骤以此来深入了解一下：

- ### 创建渲染上下文
  在`Vue2`时代，组件上相关状态都是挂载在`this`上，渲染函数执行时取值也是直接从`this`上获取，
  但是将状态、方法等内容绑定到`this`上本身就是一笔不小的性能开销，于是在`Vue3`中将`this`通过`proxy`代理的上下文来替代，节省了这部分初始化的开销；
  我们直接看到创建渲染上下文代理的代码，核心内容就是`Proxy`传入的代理`handler`。

::: tip 代理目标概览
形成一个对组件数据 setup --> data --> ctx --> props 这样优先级的一个代理，同时缓存每个 key 值对应的是哪个数据来源以加速二次访问。
:::

::: details 点击查看代理 handler 详细注释代码

```typescript
// runtime-core/componentProxy.ts
const PublicInstanceProxyHandlers: ProxyHandler<any> = {
  get({ _: instance }: ComponentRenderContext, key: string) {
    const {
      ctx,
      setupState,
      data,
      props,
      accessCache,
      type,
      appContext,
    } = instance;

    // 跳过reactivity代理，将渲染上下文设置成不可代理
    if (key === ReactiveFlags.SKIP) {
      return true;
    }

    // accessCache缓存表 key ---> 来自哪个数据源
    // 优先级： setup --> data --> ctx --> props
    let normalizedProps;
    // 非$开头
    if (key[0] !== "$") {
      // 获取已缓存的key值数据来源
      const n = accessCache![key];
      if (n !== undefined) {
        // 存在缓存直接获取
        switch (n) {
          case AccessTypes.SETUP:
            return setupState[key];
          case AccessTypes.DATA:
            return data[key];
          case AccessTypes.CONTEXT:
            return ctx[key];
          case AccessTypes.PROPS:
            return props![key];
          // default: just fallthrough
        }
      } else if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
        // 优先查找是否来自setupState
        accessCache![key] = AccessTypes.SETUP;
        return setupState[key];
      } else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
        // 第二优先级查询是否来自data
        accessCache![key] = AccessTypes.DATA;
        return data[key];
      } else if (
        // props 的情况
        // 仅缓存 组件声明过的props
        (normalizedProps = normalizePropsOptions(type)[0]) &&
        hasOwn(normalizedProps, key)
      ) {
        accessCache![key] = AccessTypes.PROPS;
        return props![key];
      } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
        // 最后从上下文中查询
        accessCache![key] = AccessTypes.CONTEXT;
        return ctx[key];
      } else {
        accessCache![key] = AccessTypes.OTHER;
      }
    }

    // 策略模式
    // publicPropertiesMap是 $开头的公开属性的getter映射表
    const publicGetter = publicPropertiesMap[key];
    let cssModule, globalProperties;
    // 公共的$开头的属性
    if (publicGetter) {
      if (key === "$attrs") {
        track(instance, TrackOpTypes.GET, key);
      }
      return publicGetter(instance);
    } else if (
      // css module 的情况暂时忽略
      (cssModule = type.__cssModules) &&
      (cssModule = cssModule[key])
    ) {
      return cssModule;
    } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
      // 用户可能设置$开头的自定义属性在上下文中
      accessCache![key] = AccessTypes.CONTEXT;
      return ctx[key];
    } else if (
      // 从全局的配置中查找属性
      ((globalProperties = appContext.config.globalProperties),
      hasOwn(globalProperties, key))
    ) {
      return globalProperties[key];
    }
  },

  set(
    { _: instance }: ComponentRenderContext,
    key: string,
    value: any
  ): boolean {
    const { data, setupState, ctx } = instance;
    if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
      setupState[key] = value;
    } else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
      data[key] = value;
    } else if (key in instance.props) {
      // 设置props是不被允许的，开发环境下报错
      __DEV__ &&
        warn(
          `Attempting to mutate prop "${key}". Props are readonly.`,
          instance
        );
      return false;
    }
    if (key[0] === "$" && key.slice(1) in instance) {
      // 实例上的$开头的属性为只读
      __DEV__ &&
        warn(
          `Attempting to mutate public property "${key}". ` +
            `Properties starting with $ are reserved and readonly.`,
          instance
        );
      return false;
    } else {
      // 最后查询全局配置来修改
      if (__DEV__ && key in instance.appContext.config.globalProperties) {
        Object.defineProperty(ctx, key, {
          enumerable: true,
          configurable: true,
          value,
        });
      } else {
        ctx[key] = value;
      }
    }
    return true;
  },

  has(
    {
      _: { data, setupState, accessCache, ctx, type, appContext },
    }: ComponentRenderContext,
    key: string
  ) {
    let normalizedProps;
    // 按优先级依次判断是否有值
    return (
      accessCache![key] !== undefined ||
      (data !== EMPTY_OBJ && hasOwn(data, key)) ||
      (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) ||
      ((normalizedProps = normalizePropsOptions(type)[0]) &&
        hasOwn(normalizedProps, key)) ||
      hasOwn(ctx, key) ||
      hasOwn(publicPropertiesMap, key) ||
      hasOwn(appContext.config.globalProperties, key)
    );
  },
};
```

:::

::: details 点击查看 publicPropertiesMap 详细代码

```typescript
// runtime-core/componentProxy.ts
const publicPropertiesMap: PublicPropertiesMap = extend(Object.create(null), {
  $: (i) => i,
  $el: (i) => i.vnode.el,
  $data: (i) => i.data,
  $props: (i) => (__DEV__ ? shallowReadonly(i.props) : i.props),
  $attrs: (i) => (__DEV__ ? shallowReadonly(i.attrs) : i.attrs),
  $slots: (i) => (__DEV__ ? shallowReadonly(i.slots) : i.slots),
  $refs: (i) => (__DEV__ ? shallowReadonly(i.refs) : i.refs),
  $parent: (i) => i.parent && i.parent.proxy,
  $root: (i) => i.root && i.root.proxy,
  $emit: (i) => i.emit,
  $options: (i) => (__FEATURE_OPTIONS_API__ ? resolveMergedOptions(i) : i.type),
  $forceUpdate: (i) => () => queueJob(i.update),
  $nextTick: () => nextTick,
  $watch: (i) => (__FEATURE_OPTIONS_API__ ? instanceWatch.bind(i) : NOOP),
} as PublicPropertiesMap);
```

:::
渲染上下文代理对象的`handler`较为冗长，但是代码并不复杂，通过注释已经解释的很清楚了；
核心在于通过`accessCache`来缓存`key`所对应的数据来源以及数据获取的优先级。

- ### 执行 setup 函数

1. #### 创建 setup 上下文
   在真正执行`setup`函数之前，会通过函数的`length`属性来检测`setup`是否使用了第二个参数，以避免创建`setupContext`带来的不必要的开销；
   但是我们不能省略还得看一看`createSetupContext`的函数内部：

```typescript
// runtime-core/component.ts
function createSetupContext(instance: ComponentInternalInstance): SetupContext {
  return {
    attrs: instance.attrs,
    slots: instance.slots,
    emit: instance.emit,
  };
}
```

代码十分简单，直接返回了`attrs`、`slots`和`emit`三个属性，这也是`setup`的`ctx`只能获取这三个属性的原因。

2. #### 执行 setup 函数
   我们看到执行`setup`函数是采用了`callWithErrorHandling`函数包裹执行的，为什么要这样处理呢？我们看一下`callWithErrorHandling`内部：

```typescript
// runtime-core/errorHanding.ts
export function callWithErrorHandling(
  fn: Function,
  instance: ComponentInternalInstance | null,
  type: ErrorTypes,
  args?: unknown[]
) {
  let res;
  try {
    res = args ? fn(...args) : fn();
  } catch (err) {
    handleError(err, instance, type);
  }
  return res;
}
```

通过`callWithErrorHandling`包裹执行，不仅能使得执行时产生的错误被正确处理，同时也能从容处理变化个数的参数。

3. #### 处理 setup 执行结果
   对于`setup`函数的执行结果，主要分为两种`promise`和其他情况；`promise`的情况下，`ssr`端会在`promise.then`中调用`handleSetupResult`,
   而`client`端会视作一个异步的依赖，并且等待重新触发；非`promise`的情况下，会直接调用`handleSetupResult`。  
   那我们直接看`handleSetupResult`函数：

```typescript
// runtime-core/component.ts
export function handleSetupResult(
  instance: ComponentInternalInstance,
  setupResult: unknown,
  isSSR: boolean
) {
  if (isFunction(setupResult)) {
    // 如果是函数则视作返回了一个内联的render函数
    instance.render = setupResult as InternalRenderFunction;
  } else if (isObject(setupResult)) {
    // 返回的是模板可绑定内容
    // 直接reactive
    instance.setupState = reactive(setupResult);
  } else if (__DEV__ && setupResult !== undefined) {
    // 如果没返回，在开发环境提出警告
    warn(
      `setup() should return an object. Received: ${
        setupResult === null ? "null" : typeof setupResult
      }`
    );
  }
  finishComponentSetup(instance, isSSR);
}
```

对于 setup 的执行结果处理也十分简单，可接受的只有 render 函数和模板可绑定对象两种结果。

4. #### 完成组件启动后续工作
   在处理完`setup`执行结果后，仍需要做两件事情：
   > 1. 规范化模板或者 render 函数
   > 2. 兼容`options API`  
   >    因为`setup`依旧有可能返回一个渲染函数，所以需要在这个时机进行模板或者 render 函数的规范化；
   >    `setup`替代了`beforeCreated`和`created`两个钩子，`vue2`的`options`也需要在这个时机来进行处理。
   >    我们直接看到`finishComponentSetup`函数内部：

```typescript
// runtime-core/component.ts
function finishComponentSetup(
  instance: ComponentInternalInstance,
  isSSR: boolean
) {
  const Component = instance.type as ComponentOptions;

  // 规范化模板或render
  if (__NODE_JS__ && isSSR) {
    // ssr下有渲染函数直接取渲染函数
    if (Component.render) {
      instance.render = Component.render as InternalRenderFunction;
    }
  } else if (!instance.render) {
    // 有模板无render，进行编译（带编译器版本）
    if (compile && Component.template && !Component.render) {
      Component.render = compile(Component.template, {
        isCustomElement: instance.appContext.config.isCustomElement || NO,
        delimiters: Component.delimiters,
      });
      // 标记是运行时编译产生的
      (Component.render as InternalRenderFunction)._rc = true;
    }

    if (__DEV__ && !Component.render) {
      /* istanbul ignore if */
      if (!compile && Component.template) {
        // 开发环境下，不带编译器版本，却又没有render提示更改vue版本
        warn(
          `Component provided template option but ` +
            `runtime compilation is not supported in this build of Vue.` +
            (__ESM_BUNDLER__
              ? ` Configure your bundler to alias "vue" to "vue/dist/vue.esm-bundler.js".`
              : __ESM_BROWSER__
              ? ` Use "vue.esm-browser.js" instead.`
              : __GLOBAL__
              ? ` Use "vue.global.js" instead.`
              : ``) /* should not happen */
        );
      } else {
        warn(`Component is missing template or render function.`);
      }
    }

    instance.render = (Component.render || NOOP) as InternalRenderFunction;

    // 由于运行时编译的render函数采用的是with语法来获取对象
    // 需要不同的代理handler
    if (instance.render._rc) {
      instance.withProxy = new Proxy(
        instance.ctx,
        RuntimeCompiledPublicInstanceProxyHandlers
      );
    }
  }

  // 支持vue2的options API
  if (__FEATURE_OPTIONS_API__) {
    currentInstance = instance;
    applyOptions(instance, Component);
    currentInstance = null;
  }
}
```

处理模板 render 的逻辑很简单，注释基本就解释清楚了；而兼容`Vue2 options API`的具体函数就不再深入探究了，
基本上依次对于`Vue2`的选项进行转换，比如`mixin`和`extend`递归调用`applyOptions`，生命周期函数就采用函数式的`onMounted`之类的进行`hack`，
等等内容，感兴趣的可以详细阅读。

## 整体流程图

![setup](/vue3-analysis/runtime/vue3-setup.jpg)

## 总结

这一篇着重分析组件新状态选项的处理流程，我们知道了`setup`的执行时机，也了解了渲染上下文代理是如何创建的，理解了模板如何和响应式对象建立联系的；
以及一些细节上的优化，比如通过`setup`函数参数个数动态选择是否创建`setupContext`、通过缓存加速渲染上下文取值的速度等等；相信对于`setup`已经有了更深层次的理解。
