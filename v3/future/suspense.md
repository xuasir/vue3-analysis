### `Suspense`

上一篇我们学习了`Vue3`中重新实现的声明异步组件的方式，其中有一部分的代码显示异步组件也可以移交给一个名为`suspense`的东西来处理；
那么`suspense`到底是什么呢？

我们都知道异步组件从加载到渲染完成之间会有一段时间间隔，`suspense`就是用来在这段时间间隔中渲染一个`fallback`内容直到异步组件渲染成功，
它的核心工作就是调和这两个阶段。我们先来看一下基本使用方式。

通常在`Vue3`中也会使用`async`的`setup`来标明为异步组件：

```typescript
// async-comp
export default {
  async setup() {
    const res = await getList();
    return { res };
  },
};
```

通过插槽来分发`fallback`内容：

```html
<Suspense>
  <template #default>
    <async-comp />
  </template>
  <template #fallback>
    loading...
  </template>
</Suspense>
```

支持两个`props`：

```typescript
export interface SuspenseProps {
  onResolve?: () => void
  onRecede?: () => void
}
```

## 本篇目标

1. 理解`suspense`是如何处理异步组件的
2. 理解`suspense`的挂载和更新流程

## 解析
`suspense`的解析会从`render`函数开始，通过`suspense`组件的处理过程来了解`suspense`的行为特性。

## `Suspense`组件的内部解析

通过[Vue 3 Template Explorer](https://vue-next-template-explorer.netlify.app)来获取上文的`Suspense`模板编译后的`render`函数如下：

```typescript
export function render(_ctx, _cache, $props, $setup, $data, $options) {
  const component_async_comp = resolveComponent("async-comp")

  return (openBlock(), createBlock(Suspense, null, {
    default: withCtx(() => [
      createVNode(component_async_comp)
    ]),
    fallback: withCtx(() => [
      createTextVNode(" loading... ")
    ]),
    _: 1
  }))
}
```

我们可以看`Suspense`和我们的插槽组件生成的是同样的渲染函数，但是这个`Suspense`内置组件到底是什么呢？

```typescript
// runtime-core/components/Suspense.ts
export const Suspense = SuspenseImpl
   as {
  __isSuspense: true
  new (): { $props: VNodeProps & SuspenseProps }
}

export const SuspenseImpl = {
  __isSuspense: true,
  process() {},
  hydrate: hydrateSuspense
}
```
在内部的实现中`Suspense`组件是通过一个`SuspenseImpl`接口定义的，这个接口在之后我们会详细解析；
我们知道通常一个组件应该是需要符合`options API`或者`functional API`的声明方式，
但是这里的`Suspense`仅仅是看起来像一个组件，对外部的使用者来说是会作为组件来处理，对于内部的处理却和组件相差甚远，
我们继续看看`Suspense`组件的挂载处理。

我们知道在`createBlock`中最终会调用`_createVNode`来创建`VNode`，而组件的信息会被保存在`组件VNode`的`type`属性上，
并且会为`组件VNode`打上相应的`patchFlags`；之后通过`mount`的触发就会来到组件的`patch`阶段。
至此从模板到`VNode`的解析阶段就已经结束了，我们接下来要看的就是`patch`阶段对于`Suspense`的处理。

## `Suspense`组件的挂载

```typescript
// runtime-core/renderer.ts
//...
if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
  ;(type as typeof SuspenseImpl).process(
    n1,
    n2,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    optimized,
    internals
  )
// ...
```
从`patch`函数中对于`Suspense`的处理来看，内部的处理并没有将其作为一个真正的组件来创建实例等等操作，
而是直接使用`SuspenseImpl`接口的`process`来处理挂载和更新，我们继续看到`process`函数。

```typescript
// runtime-core/components/Suspense.ts
process(
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean,
    // host平台 相关方法
    rendererInternals: RendererInternals
  ) {
    if (n1 == null) {
      // 挂载阶段
      mountSuspense(
        n2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        optimized,
        rendererInternals
      )
    } else {
      // 更新阶段
      patchSuspense(
        n1,
        n2,
        container,
        anchor,
        parentComponent,
        isSVG,
        optimized,
        rendererInternals
      )
    }
  }
```

`process`依旧作为一个分发的函数，我们先关注到挂载函数：

```typescript
// runtime-core/components/Suspense.ts
function mountSuspense(
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized: boolean,
  rendererInternals: RendererInternals
) {
  const {
    p: patch,
    o: { createElement }
  } = rendererInternals
  // 创建缓存 子树的节点
  const hiddenContainer = createElement('div')
  // 生成 子树和fallback树
  const suspense = (n2.suspense = createSuspenseBoundary(
    n2,
    parentSuspense,
    parentComponent,
    container,
    hiddenContainer,
    anchor,
    isSVG,
    optimized,
    rendererInternals
  ))

  // 挂载 子树
  patch(
    null,
    suspense.subTree,
    hiddenContainer,
    null,
    parentComponent,
    suspense,
    isSVG,
    optimized
  )
  // 是否存在异步依赖
  if (suspense.deps > 0) {
    // 存在异步依赖，挂载fallback树
    patch(
      null,
      suspense.fallbackTree,
      container,
      anchor,
      parentComponent,
      null, // fallback tree will not have suspense context
      isSVG,
      optimized
    )
    n2.el = suspense.fallbackTree.el
  } else {
    // 不存在依赖直接 resolve suspense
    suspense.resolve()
  }
}
```

我们回顾组件的挂载过程，需要先创建组件实例再执行组件的渲染函数生成`VNode`子树再对`VNode Tree`进行`patch`生成真实的`Dom`；
这里对于`suspense`的处理也是如此，我们先通过`createSuspenseBoundary`（相当于`suspense`的`render`函数和创建实例方法）
来创建`suspense`实例并且渲染`subTree`和`fallbackTree`两棵`VNode`子树；
然后将按`suspense`的`resolve`状态来判定挂载哪一棵子树到真实的`Dom`中。

在这期间我们需要搞清楚两个问题，如何创建的`subTree`和`fallbackTree`以及如何进行异步依赖收集？我们一个个来深入解析。

#### 1. 创建`subTree`和`fallbackTree`

```typescript
// runtime-core/components/Suspense.ts
function createSuspenseBoundary(
  vnode: VNode,
  parent: SuspenseBoundary | null,
  parentComponent: ComponentInternalInstance | null,
  container: RendererElement,
  hiddenContainer: RendererElement,
  anchor: RendererNode | null,
  isSVG: boolean,
  optimized: boolean,
  rendererInternals: RendererInternals,
  isHydrating = false
): SuspenseBoundary {
  const {
    p: patch,
    m: move,
    um: unmount,
    n: next,
    o: { parentNode }
  } = rendererInternals
  // 获取当前suspense 所渲染的子树
  const getCurrentTree = () =>
    suspense.isResolved || suspense.isHydrating
      ? suspense.subTree
      : suspense.fallbackTree
  // 生成子树VNode
  const { content, fallback } = normalizeSuspenseChildren(vnode)
  // 创建suspense
  const suspense: SuspenseBoundary = {
    vnode,
    parent,
    parentComponent,
    isSVG,
    optimized,
    container,
    hiddenContainer,
    anchor,
    deps: 0,
    subTree: content,
    fallbackTree: fallback,
    isHydrating,
    isResolved: false,
    isUnmounted: false,
    effects: [],

    resolve() {},

    recede() {},

    move(container, anchor, type) {
      move(getCurrentTree(), container, anchor, type)
      suspense.container = container
    },

    next() {
      return next(getCurrentTree())
    },

    registerDep(instance, setupRenderEffect) {},

    unmount(parentSuspense, doRemove) {}
  }

  return suspense
}
```

`createSuspenseBoundary`主要创建了一个`SuspenseBoundary`实例，我们先看一下他的`interface`：

::: details 点击查看 SuspenseBoundary 注释代码

```typescript
// runtime-core/components/Suspense.ts
export interface SuspenseBoundary {
  // susupense VNode
  vnode: VNode<RendererNode, RendererElement, SuspenseProps>
  // 父suspense 实例
  parent: SuspenseBoundary | null
  // 父组件实例
  parentComponent: ComponentInternalInstance | null
  isSVG: boolean
  optimized: boolean
  // 子树渲染的容器
  container: RendererElement
  // subTree 临时存放元素
  hiddenContainer: RendererElement
  // 相对锚点
  anchor: RendererNode | null
  // 异步子树
  subTree: VNode
  // fallback树
  fallbackTree: VNode
  // 依赖数目
  deps: number
  isHydrating: boolean
  // 是否已经resolved
  isResolved: boolean
  // 是否已经卸载
  isUnmounted: boolean
  // 副作用函数列表
  effects: Function[]
  // resolve suspense 
  resolve(): void
  // 重设 suspense 返回未resolve 状态
  recede(): void
  // 移动
  move(
    container: RendererElement,
    anchor: RendererNode | null,
    type: MoveType
  ): void
  next(): RendererNode | null
  // 向该suspense注册异步依赖
  registerDep(
    instance: ComponentInternalInstance,
    setupRenderEffect: SetupRenderEffectFn
  ): void
  // 卸载
  unmount(parentSuspense: SuspenseBoundary | null, doRemove?: boolean): void
}
```

:::

在上面的注释代码中已经详尽的标记了每个属性的只能，可以看出之后与`suspense`相关的挂载、依赖注册、`resolve`等等操作都是依附于该实例的，相关的方法我们在后续解析时遇到了在详细解析，现在我们着重关注`normalizeSuspenseChildren`这个生成`VNode`子树的函数。

```typescript
// runtime-core/components/Suspense.ts
export function normalizeSuspenseChildren(
  vnode: VNode
): {
  content: VNode
  fallback: VNode
} {
  const { shapeFlag, children } = vnode
  if (shapeFlag & ShapeFlags.SLOTS_CHILDREN) {
    const { default: d, fallback } = children as Slots
    return {
      content: normalizeVNode(isFunction(d) ? d() : d),
      fallback: normalizeVNode(isFunction(fallback) ? fallback() : fallback)
    }
  } else {
    return {
      content: normalizeVNode(children as VNodeChild),
      fallback: normalizeVNode(null)
    }
  }
}
```

在`normalizeSuspenseChildren`是直接将他的两个`slot children`执行来获得两颗`VNode`子树的，至此我们已经得到了`suspense`实例和两颗`VNode`子树，下一步就需要将`VNode`树转化成真实的`dom`也就是`patch`阶段。

#### 2. 异步依赖的注册

在第二章节解析组件`setup`函数的时候，我们就遇到过`setup`返回`promise`的情况，
而在`suspense`中异步组件的`setup`返回的正是`promise`，
那我们就很自然的想到`suspense`的异步依赖注册会发生在组件的`mount`阶段。
我们应该回到`mountComponent`中对于`setup`及其结果的处理中去： 

```typescript
// runtime-core/componet.ts
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
  ))
  // 执行setup
  setupComponent(instance)
  if (__FEATURE_SUSPENSE__ && instance.asyncDep) {
    // 向父 suspense 注册异步依赖
    parentSuspense.registerDep(instance, setupRenderEffect)
    // 创建一个注释节点
    if (!initialVNode.el) {
      const placeholder = (instance.subTree = createVNode(Comment))
      processCommentNode(null, placeholder, container!, anchor)
    }
    return
  }
}
// 发生在 setupComponent 中
function setupStatefulComponent(
  instance: ComponentInternalInstance,
  isSSR: boolean
) {
  // 执行 setup 得到 setupResult
  if (isPromise(setupResult)) {
      instance.asyncDep = setupResult
  }
  // 其他情况处理
}
```

我们看到在`setupComponent`中将`async setup`返回的`promise`赋值到了组件实例的`asyncDep`中，
再之后就通过父`suspense`实例的`registerDep`来注册异步依赖，完成后就向`dom`中追加了一个注释节点。
我们接下来看一下`registerDep`都做了些什么？

```typescript
// runtime-core/components/Suspense.ts
registerDep(instance, setupRenderEffect) {
  if (suspense.isResolved) {
    // 如果 suspense 已经被 resolved 那就回退 suspense 到 非resolved 状态ß
    queueJob(() => {
      suspense.recede()
    })
  }

  const hydratedEl = instance.vnode.el
  // 异步依赖计数加一
  // suspense 可以包含多个异步组件
  suspense.deps++
  instance
    .asyncDep!.catch(err => {
      // 错误处理
      handleError(err, instance, ErrorCodes.SETUP_FUNCTION)
    })
    .then(asyncSetupResult => {
      // 在resolved之前，组件或者suspense被卸载
      if (instance.isUnmounted || suspense.isUnmounted) {
        return
      }
      // 一个异步依赖已经resolved 计数减一
      suspense.deps--
      instance.asyncResolved = true
      const { vnode } = instance
      // 处理 setupResult 
      handleSetupResult(instance, asyncSetupResult, false)
      // 执行组件渲染函数
      setupRenderEffect(
        instance,
        vnode,
        hydratedEl
          ? parentNode(hydratedEl)!
          : parentNode(instance.subTree.el!)!,
        hydratedEl ? null : next(instance.subTree),
        suspense,
        isSVG,
        optimized
      )
      updateHOCHostEl(instance, vnode.el)
      // 当所有异步依赖都 resolved suspense将resolved
      if (suspense.deps === 0) {
        suspense.resolve()
      }
    })
}
```

`Vue3`的异步组件是强依赖于`promise`的，所谓的注册依赖其实主要做了一些几件事情：

1. 向`suspense`实例中增加一个依赖数量
2. 在`async setup`返回的`promise`的`then`函数中添加`asyncSetupResult`的处理

其实注册依赖就是将同步组件中在得到`setupResult`后进行的`handleSetupResult`和`setupRenderEffect`两个步骤，
放置在了异步组件`setup promise`的`onResolved`中进行处理；还有一个值得注意的点就是，`suspense`会等到所有异步依赖都`resolved`才会真正的`resolve`；我们再看一下`suspense.resolve()`都做了些什么。

#### 3. `suspense`的`resolve`

```typescript
// runtime-core/components/Suspense.ts
resolve() {
  const {
    vnode,
    subTree,
    fallbackTree,
    effects,
    parentComponent,
    container
  } = suspense
  let { anchor } = suspense
  if (fallbackTree.el) {
    // fallback 已经挂载 需要先卸载
    anchor = next(fallbackTree)
    unmount(fallbackTree, parentComponent, suspense, true)
  }
  // 挂载 subTree
  move(subTree, container, anchor, MoveType.ENTER)
  // suspense 直接作为组件的根元素时
  // 需要更新 组件VNode的el
  const el = (vnode.el = subTree.el!)
  if (parentComponent && parentComponent.subTree === vnode) {
    parentComponent.vnode.el = el
    // 高阶组件的情况
    // 递归更新
    updateHOCHostEl(parentComponent, el)
  }
  // 分情况 执行effects
  // 嵌套 suspense 的需要向上查找 pending状态的 suspense
  let parent = suspense.parent
  let hasUnresolvedAncestor = false
  while (parent) {
    if (!parent.isResolved) {
      // 查找到了 pending状态的suspense 将effects 移交给该suspense去执行
      parent.effects.push(...effects)
      hasUnresolvedAncestor = true
      break
    }
    parent = parent.parent
  }
  // 没有 pending 的父suspense 直接 执行所有effects任务
  if (!hasUnresolvedAncestor) {
    queuePostFlushCb(effects)
  }
  suspense.isResolved = true
  suspense.effects = []
  // 调用 onResolve 钩子
  const onResolve = vnode.props && vnode.props.onResolve
  if (isFunction(onResolve)) {
    onResolve()
  }
}
```

我将`suspense`的`resolve`划分为几个步骤，我们依次分析一下这些核心步骤：

#### 1. 卸载 `fallbackTree`和挂载 `subTree`

卸载`fallbackTree`和挂载`subTree`就是简单的通过宿主平台`API`来移动`Dom`元素，
在`suspense.resolve`之前就已经完成了`patch`所以可以直接移动。

#### 2. 处理 `effects`

`effects`的处理需要注意这里的`effects`都是些什么副作用是如何被添加的？想要搞清楚这个问题我们就要关注到一个调度方法：

```typescript
// runtime-core/components/Suspense.ts
export function queueEffectWithSuspense(
  fn: Function | Function[],
  suspense: SuspenseBoundary | null
): void {
  // 存在 suspense 会推入到suspense.effects
  if (suspense && !suspense.isResolved) {
    if (isArray(fn)) {
      suspense.effects.push(...fn)
    } else {
      suspense.effects.push(fn)
    }
  } else {
    // 否则正常的调度
    queuePostFlushCb(fn)
  }
}
```

我们看到这个调度方法会分两种情况来处理，而`suspense`的情况会被添加到`suspense.effects`,
那么`queueEffectWithSuspense`的调用存在哪里呢？

```typescript
// runtime-core/renderer.ts
export const queuePostRenderEffect = __FEATURE_SUSPENSE__
  ? queueEffectWithSuspense
  : queuePostFlushCb
// 组件渲染函数
const setupRenderEffect = () => {
  // ... 很多其他操作
  // mounted hook
  if (m) {
    queuePostRenderEffect(m, parentSuspense)
  }
  // ...
}
```

这里仅截取一个`mounted`钩子，还有`updated`、`unMounted`等钩子都是调用了`queueEffectWithSuspense`来添加；
对于组件的这些渲染后调度都会和`parentSuspense`相关，那就意味着我们在`suspense.resolve`中处理的`effects`都来自与该`suspense`的子组件；再关注到`resolve`中的处理方式，我们需要在没有查找到`pending`状态的`父suspense`时去执行`effects`否则会移交给`pending`状态的`父suspense`接管，那就是说`suspense`中异步组件真正的`mounted`调用时机发生在`suspense`被`resolved`的时候。

#### 3. 调用 `onResolve`钩子

`suspense`再被真正的`resolved`后，会调用通过`props`传递的`onResolve`钩子函数。

这就是`suspense.resolve`的全流程，核心在于对子树的处理以及`effects`的处理特性需要掌握好。

## `suspense`的`recede`

之前在讨论`suspense.registerDep`时提到了一个`recede`回退成未`resolved`状态的，我们来看一下它的具体实现：

```typescript
// runtime-core/components/Suspense.ts
recede() {
  // 重新设置成未 resolved
  suspense.isResolved = false
  const {
    vnode,
    subTree,
    fallbackTree,
    parentComponent,
    container,
    hiddenContainer,
    isSVG,
    optimized
  } = suspense
  // 移除 subTree
  const anchor = next(subTree)
  move(subTree, hiddenContainer, null, MoveType.LEAVE)
  // 重新挂载 fallbackTree
  patch(
    null,
    fallbackTree,
    container,
    anchor,
    parentComponent,
    null,
    isSVG,
    optimized
  )
  const el = (vnode.el = fallbackTree.el!)
  // 向上更新 el 组件和 高阶组件的情况
  if (parentComponent && parentComponent.subTree === vnode) {
    parentComponent.vnode.el = el
    updateHOCHostEl(parentComponent, el)
  }

  // 调用 onRecede 钩子
  const onRecede = vnode.props && vnode.props.onRecede
  if (isFunction(onRecede)) {
    onRecede()
  }
}
```

`recede`核心的还是将`suspense`重新置成未`resolved`的状态，再还原其显示子树为`fallback`，最终调用了`onRecede`钩子函数。

## 整体流程图
![suspense](/vue3-analysis/future/suspense.jpg)

## 总结
至此我们已经了解到了`suspense`从解析到`resolve`的全过程，我们来总结一下`suspense`的特性：

1. `suspense`会通过`default`插槽接收若干个异步组件甚至可以是嵌套的异步组件，`suspense`会在它所包含的所有异步组件全部被`resolved`后执行`resolve`。

2. `suspense`接收的异步组件的`mounted`等钩子函数会在`suspense resolved`后进行调用。