### 组件 mount 流程

当我们创建了`app`实例后会调用`mount`方法将其挂载到某个`html`节点上，那么这期间到底发生了什么？组件是如何转化成真实`dom`的？
本节我们关心的就是这样的问题。

## 本篇目标

1. 了解`Vue3`组件挂载的整体流程
2. 普通元素的挂载流程
3. 嵌套组件如何被挂载

## 前置知识

在挂载过程中会涉及到虚拟`Dom`和`Vnode`这样的抽象概念，了解该概念的可以直接看下面的解析部分，不了解的可以看一下代码中关于`Vnode`的`interface`：

```ts
export interface VNode<
  HostNode = RendererNode,
  HostElement = RendererElement,
  ExtraProps = { [key: string]: any }
> {
  // 是否为Vnode对象的标识
  __v_isVNode: true;
  // 跳过reactivity的标识
  __v_skip: true;
  // vnode类型标识
  type: VNodeTypes;
  // vnode props
  props: (VNodeProps & ExtraProps) | null;
  // vnode的唯一key值
  key: string | number | null;
  ref: VNodeNormalizedRef | null;
  scopeId: string | null; // SFC only
  // 子Vnode
  children: VNodeNormalizedChildren;
  // 对应组件实例
  component: ComponentInternalInstance | null;
  suspense: SuspenseBoundary | null;
  dirs: DirectiveBinding[] | null;
  transition: TransitionHooks<HostElement> | null;

  // DOM
  // vnode对应元素 组件vnode则对应 挂载容器
  el: HostNode | null;
  // 相对锚点
  anchor: HostNode | null; // fragment anchor
  // teleport组件的渲染目标元素
  target: HostElement | null; // teleport target
  // teleport组件的渲染目标元素相对锚点
  targetAnchor: HostNode | null; // teleport target anchor
  staticCount: number; // number of elements contained in a static vnode

  // optimization only
  // vnode 优化标识
  shapeFlag: number;
  // patch 标识
  patchFlag: number;
  // block优化下的效果：
  // 扁平的动态props
  dynamicProps: string[] | null;
  // 扁平的动态子节点
  dynamicChildren: VNode[] | null;

  // 只有根组件拥有app上下文
  appContext: AppContext | null;
}
```

所谓的`Vnode`也就是通过`JavaScript`对象来抽象描述`dom`元素，而虚拟`dom`就是由多个`Vnode`组成和`Dom`结构一一对应的一棵虚拟`Dom`树；
虚拟`Dom`的优势不在于它拥有多快的速度而在于它的抽象能力，在`diff`出整个变更的最小更改之前可以在虚拟`Dom`下进行操作，
直接操作`js`对象的性能势必比操作真实`Dom`更加高效，而且`diff`能保证每次对 Dom 的实际操作达到一个下限的保证；
在渲染器和`web`平台的解耦中，虚拟`Dom`也有着不可替换的重要作用。

## 通篇解析`demo`模板

由于是解析整个应用的挂载过程为了统一文中描述，我将采用如下的应用书写，来进行分析：

```js
let { reactive, toRefs } = Vue;
const Hello = {
  name: "hello",
  props: ["msg"],
  template: `
      <div>
        hello child {{ msg }}
      </div>
    `,
};
const App = {
  components: {
    Hello,
  },
  template: `
      <div id="root" @click="add">
				<p>parent</p>
        <hello :msg="num" />
      </div>
    `,
  setup() {
    let state = reactive({ num: ["a", "b", "c", "d", "e"] });
    function add() {
      state.num = ["a", "c", "d", "b", "e"];
    }
    return {
      ...toRefs(state),
      add,
    };
  },
};

Vue.createApp(App).mount("#app");
```

## 解析

`mount`解析的开始自然是用户调用`mount`开始，用户调用的`mount`是经过重写的`mount`函数这个在上一篇中能了解到，
而真实的组件实例的`mount`函数也是会被调用，我们回到文件：`runtime-core/apiCreateApp.ts`中：

```ts
// runtime-core/apiCreateApp.ts
mount(rootContainer: HostElement, isHydrate?: boolean): any {
        if (!isMounted) {
          // 创建根组件Vnode
          const vnode = createVNode(rootComponent as Component, rootProps)
          // 根组件Vnode 拥有 根app上下文
          vnode.appContext = context
          // 从根组件Vnode开始渲染
          render(vnode, rootContainer)
          // 标识已挂载
          isMounted = true
          // 绑定根实例和根容器
          app._container = rootContainer
          ;(rootContainer as any).__vue_app__ = app
          // 返回根组件的代理
          return vnode.component!.proxy
        }
      }
```

从`mount`函数的流程上来看，我们在挂载一个应用时，基本可以作为三步来理解：
::: tip 主要流程

1.  根据根组件信息来创建根`组件Vnode`并且设置好`根组件Vnode`对应的上下文信息
2.  从 `根组件Vnode`开始递归渲染生成整棵 Dom 树并且挂载到根容器上
3.  处理根组件挂载完后的相关工作并返回根组件的代理
    :::
    现在就可以从几个疑问开始深入探究：

- ## `根组件Vnode`如何创建的？

  通过`import`我们能在`runtime-core/vnode.ts`找到`createVNode`函数的本尊：

  ```ts
  // runtime-core/vnode.ts
  function _createVNode(
    type: VNodeTypes | ClassComponent | typeof NULL_DYNAMIC_COMPONENT,
    props: (Data & VNodeProps) | null = null,
    children: unknown = null,
    patchFlag: number = 0,
    dynamicProps: string[] | null = null,
    isBlockNode = false
  ): VNode {
    // 规范化 class & style
    if (props) {
      // ...
      props.class = normalizeClass(klass);
      // ...
      props.style = normalizeStyle(style);
    }

    // VNode形态编码 来自枚举类ShapFlags
    const shapeFlag = isString(type)
      ? ShapeFlags.ELEMENT
      : __FEATURE_SUSPENSE__ && isSuspense(type)
      ? ShapeFlags.SUSPENSE
      : isTeleport(type)
      ? ShapeFlags.TELEPORT
      : isObject(type)
      ? ShapeFlags.STATEFUL_COMPONENT
      : isFunction(type)
      ? ShapeFlags.FUNCTIONAL_COMPONENT
      : 0;

    const vnode: VNode = {
      // VNode类型
      type,
      props,
      key: props && normalizeKey(props),
      ref: props && normalizeRef(props),
      // ...
    };
    // 规范化子节点---> 确定children的类型，规范化children成数组形态、插槽形态或者string、null
    normalizeChildren(vnode, children);

    return vnode;
  }
  ```

  整体来说创建一个`VNode`主要是对`VNode`的形态类型进行确定、class 和 style 进行规范化，
  然后通过对象字面量的方式来创建`VNode`最后是对`children`进行规范化；依据当前的额`type`情况，
  我们得到的应该是一个`ShapeFlags.STATEFUL_COMPONENT`类型的`组件VNode`，
  回到`mount`方法中我们将 app 上下文挂载到`根组件VNode`的`AppContext`属性上后就开始调用 render 开始进行从根组件开始的挂载工作了；
  这样我们就可以进入下一个疑问。

- ## render 函数的流程

  ::: tip 主要关注内容
  在 render 中如何递归的渲染子组件和普通元素呢？如何产生递归关系将整个组件树形成的虚拟 Dom 树渲染完毕的呢？
  :::

  我们在同一文件中(`runtime-core/apiCreateApp.ts`)可以找到`render函数`，注意这个`render函数`与`组件的render函数`并不是同一个概念，
  当前的`render函数`是用来挂载某个组件或者`VNode`到某个容器上的渲染函数，而`组件的render函数`使用来生成组件的`子VNode树`的函数。

  ```ts
  // runtime-core/apiCreateApp.ts
  const render: RootRenderFunction = (vnode, container) => {
    if (vnode == null) {
      // 无新的vnode入参 则代表是卸载
      if (container._vnode) {
        unmount(container._vnode, null, null, true);
      }
    } else {
      // 挂载分支
      patch(container._vnode || null, vnode, container);
    }
    // 执行postFlush任务队列
    flushPostFlushCbs();
    // 保存当前渲染完毕的根VNode在容器上
    container._vnode = vnode;
  };
  ```

  在`render`中我们本次要执行的就是`patch`方法，后面执行与调度相关的方法可以暂时忽略；
  `patch`方法是`Vue`中进行`VNode`操作的重要方法，被称作是打补丁方法，是进行`VNode`递归挂载和`diff`的递归函数，
  我们直接进入到`patch`的函数体便能更清楚的知道它的具体作用了。

  `patch`函数依旧是定义在同一文件中：

  ```ts
  // runtime-core/renderer.ts
  const patch: PatchFn = (
    	// 旧VNode
      n1,
    	// 新VNode
      n2,
    	// 挂载容器
      container,
    	// 调用web dom API的insertBefore时传递的相对节点
      anchor = null,
      parentComponent = null,
      parentSuspense = null,
      isSVG = false,
      optimized = false
    ) => {
      // 判断不是同一个VNode直接卸载旧的子树
      if (n1 && !isSameVNodeType(n1, n2)) {
        // 获取插入的标识位
        anchor = getNextHostNode(n1)
        unmount(n1, parentComponent, parentSuspense, true)
        n1 = null
      }
  		// 取出关键信息
      const { type, ref, shapeFlag } = n2
      switch (type) {
        case Text:
          // 处理文本节点...
          break
        case Comment:
          // 处理注释节点...
          break
        case Static:
          // 处理静态节点...
          break
        case Fragment:
          // 处理fragment ...
          break
        default:
          // 判断VNode类型
          if (shapeFlag & ShapeFlags.ELEMENT) {
            // 处理元素节点
            processElement(...)
          } else if (shapeFlag & ShapeFlags.COMPONENT) {
            // 处理组件
            processComponent(...)
          } else if (shapeFlag & ShapeFlags.TELEPORT) {
            // 处理 teleport组件
            ;(type as typeof TeleportImpl).process(...)
          } else if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
            // 处理suspense组件
            ;(type as typeof SuspenseImpl).process(...)
          } else if (__DEV__) {
            warn('Invalid VNode type:', type, `(${typeof type})`)
          }
      }
    }
  ```

  整体上来看`patch`函数的作用就是通过对当前`VNode`类型的判断来确定下一步需要具体执行的子逻辑，
  由此我们可以想象在当前`VNode`的子逻辑执行完毕到需要去挂载 chidren 的时候时候我们任然会回到`patch`函数，来通过`patch`将 patch 逻辑分发到具体的子逻辑，
  这也是挂载整个应用树递归的方式。这种拆分子逻辑的方式很好的将子过程分发到不同的子函数中，让子函数关注的类型与逻辑可以单一化，
  这样无论是从代码的可读性和扩展性都是有很大的提升，这样的技巧是非常值得学习的。

  同时`Vue3`在处理`VNode`的`shapeFlag`时采用了位运算的方式，展开的话也有挺多能讲的为了不影响主线，可以暂时将`&`理解成检查是否是某一类型，`|`理解成授予某一类型。

  1. ### 组件的挂载

     我们回到主线从`render函数`进入到`patch`中现在的`VNode`应该是`根组件VNode`这是毫无疑问的，那我们应该进入到`processComponent`函数中：

     ```ts
     // runtime-core/renderer.ts
     const processComponent = (...) => {
         if (n1 == null) {
           // 挂载组件
           mountComponent(
             n2,
             container,
             anchor,
             parentComponent,
             parentSuspense,
             isSVG,
             optimized
           )
         } else {
           // 更新组件
           updateComponent(n1, n2, optimized)
         }
       }
     ```

     可以得知`processComponent`函数主要作用也是分发子逻辑，咱们主要关注的是挂载，所以直接看到`mountComponent`函数：

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
       // setup函数为异步的相关处理 忽略相关逻辑
       if (__FEATURE_SUSPENSE__ && instance.asyncDep) {
         parentSuspense.registerDep(instance, setupRenderEffect);
         if (!initialVNode.el) {
           const placeholder = (instance.subTree = createVNode(Comment));
           processCommentNode(null, placeholder, container!, anchor);
         }
         return;
       }
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

     `mountComponent`函数代码量依旧不大，这也是`Vue3`代码组织的特点，函数专职专供，整体流程清晰；简单分析可得出`mountComponent`函数主要做了三件事情：

     > 1. 创建组件实例
     > 2. 启动组件 setup
     > 3. 创建带副作用的 render 函数

     三个流程执行完毕组件也就完成了挂载，我们一个个来分析。

     1. #### `createComponentInstance`

        我们来到文件：`runtime-core/component.ts`找到`createComponentInstance`函数如下：

        ```ts
        export function createComponentInstance(
          vnode: VNode,
          parent: ComponentInternalInstance | null,
          suspense: SuspenseBoundary | null
        ) {
          // 继承自父组件的appContext，如果是根组件VNode从根VNode中取得
          const appContext =
            (parent ? parent.appContext : vnode.appContext) || emptyAppContext
          // 通过对象字面量创建instance
          const instance: ComponentInternalInstance = {...}
          instance.ctx = { _: instance }
          instance.root = parent ? parent.root : instance
          instance.emit = emit.bind(null, instance)
          return instance
        }
        ```

        该函数主要是通过对象字面量来创建`instance`，然后返回；逻辑并没有复杂的点，我们主要聚焦在`instance`的`interface`来了解组件实例都包含了一些什么属性。

        ```ts
        export interface ComponentInternalInstance {
          // 组件唯一id
          uid: number
          // 组件options
          type: Component
          // 父组件实例
          parent: ComponentInternalInstance | null
          // 根组件实例
          root: ComponentInternalInstance
          // 根组件上下文
          appContext: AppContext
          // 组件对应VNode 代替组件存在父亲的vdom树中
          vnode: VNode
          // 来自父亲更新时生成的下一个状态的VNode 内部属性
          next: VNode | null
          // 以当前组件VNode为根的vdom子树
          subTree: VNode
          // 带副作用的渲染函数
          update: ReactiveEffect
          // 渲染生成vdom树的函数 内部属性
          render: InternalRenderFunction | null
          // 注入数据 内部属性
          provides: Data
          // 收集与该组件相关的副作用，便于在卸载的时候清除 内部属性
          effects: ReactiveEffect[] | null
          // 缓存代理访问类型 内部属性
          accessCache: Data | null
          // 渲染函数缓存优化相关 内部属性
          renderCache: (Function | VNode)[]
          // 组件级组件注册表 原型指向根组件的组件注册表方便快速访问全局注册组件 内部属性
          components: Record<string, Component>
          // 注册指令表
          directives: Record<string, Directive>
          // 组件代理相关
          proxy: ComponentPublicInstance | null
          withProxy: ComponentPublicInstance | null
          ctx: Data

          // 内部状态
          data: Data
          props: Data
          attrs: Data
          slots: InternalSlots
          refs: Data
          emit: EmitFn
          // 收集带 .once的emit事件
          emitted: Record<string, boolean> | null
        	// setup相关
          setupState: Data
          setupContext: SetupContext | null
          // suspense相关
          suspense: SuspenseBoundary | null
          asyncDep: Promise<any> | null
          asyncResolved: boolean

          // 生命周期相关标识
          isMounted: boolean
          isUnmounted: boolean
          isDeactivated: boolean
          // 生命周期hook
          ...
        }
        ```

        由此可见`instance`所包含的信息还是非常大的，里面也不乏一些特定功能相关的属性，其实大可不必硬记住有哪些属性，
        暂时将这个`interface`当做一个查找表，在接下来的解析中使用到了哪一些便查找就可以了解到对应属性设立的意义；
        总之我们通过`createComponentInstance`得到了一个信息量巨大的`instance`，再次回到`mountComponent`看到下一个阶段。

     2. #### `setupComponent`

        `setupComponent`函数主要的职责还是初始化`props`和`slots`然后执行`setup`函数或者是兼容`options API`得到最终`instance`的`state`；
        `setupComponent`的具体解析会放在后面的解析`setup()`流程篇章中，我们暂时只看一下`setupComponent`的函数体：

        ```ts
        // runtime-core/omponent.ts
        export function setupComponent(
          instance: ComponentInternalInstance,
          isSSR = false
        ) {
          const { props, children, shapeFlag } = instance.vnode;
          // 是否是包含状态的组件
          const isStateful = shapeFlag & ShapeFlags.STATEFUL_COMPONENT;
          // 初始化Props
          initProps(instance, props, isStateful, isSSR);
          // 初始化Slots
          initSlots(instance, children);
          // 如果是包含状态的函数，就执行状态函数得到状态
          const setupResult = isStateful
            ? setupStatefulComponent(instance, isSSR)
            : undefined;

          return setupResult;
        }
        ```

     3. #### `setupRenderEffect`

        上述两个步骤完成后，渲染阶段的准备工作也已经完成了，我们有了`instance`、`Props`、`Slots`和`state`就可以开始`render`了；

        ```ts
        // runtime-core/renderer.ts
        const setupRenderEffect: SetupRenderEffectFn = (
            instance,
            initialVNode,
            container,
            anchor,
            parentSuspense,
            isSVG,
            optimized
          ) => {
            // 创建执行带副作用的渲染函数并保存在update属性上
            instance.update = effect(function componentEffect() {
              if (!instance.isMounted) {
                // 未挂载的情况
                let vnodeHook: VNodeHook | null | undefined
                const { el, props } = initialVNode
                const { bm, m, a, parent } = instance
                // 以当前组件为根渲染子节点
                const subTree = (instance.subTree = renderComponentRoot(instance))
                // patch子树
                patch(
                  null,
                  subTree,
                  container,
                  anchor,
                  instance,
                  parentSuspense,
                  isSVG
                )
        				// 挂载后处理
                initialVNode.el = subTree.el
                instance.isMounted = true
              } else {
                // 更新组件
                ...
              }
            }, effectOptions)
          }
        ```

        直接看到函数的整体逻辑，主要是分为两个步骤：

        > 1. 渲染组件子树
        > 2. patch 子树

        `patch`子树的时候也就是递归挂载组件`VNode Tree`的时机，当然子树包含的可能是子组件也可能是 Dom 元素这就是`patch`的分发逻辑工作了；
        当然我们首先要将`renderComponentRoot`的子逻辑过程理解清楚，我们现在来到文件 `runtime-core/componentRenderUtils.ts`找到`renderComponentRoot`的函数体，
        当然首先得明确`renderComponentRoot`函数是通过接受`instance`得到一个`VNode`的过程，在看到他的函数体：

        ```ts
        export function renderComponentRoot(
          instance: ComponentInternalInstance
        ): VNode {
          // 获取相关信息
          const {...} = instance
          let result
          // 设置渲染实例
          currentRenderingInstance = instance
          try {
           	// 带状态的组件
            if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
              // 获取渲染代理
              const proxyToUse = withProxy || proxy
              // 执行render函数
              result = normalizeVNode(
                render!.call(
                  proxyToUse,
                  proxyToUse!,
                  renderCache,
                  props,
                  setupState,
                  data,
                  ctx
                )
              )
            } else {
              // 函数式组件
              const render = Component as FunctionalComponent
              // 直接执行组件函数
              result = normalizeVNode(
                // 查看是否需要第二个参数
                render.length > 1
                  ? render(
                      props,
                      { attrs, slots, emit }
                    )
                  : render(props, null as any)
              )
            }
          } catch (err) {
            handleError(err, instance, ErrorCodes.RENDER_FUNCTION)
            result = createVNode(Comment)
          }
          // 置空正在渲染实例
          currentRenderingInstance = null

          return result
        }
        ```

        `renderComponentRoot`核心是通过组件的`render函数`来得到组件子树，也没什么太多可讲的，
        我们回到 `setupRenderEffect`接下来就是递归`patch`的过程了，当我们`patch`完子树后整个组件的 mount 过程也就结束啦。

  2. ### 普通元素的挂载

     在完成组件子树生成后，再度进入到`patch`函数中，这次我们拿到的`VNode`对象已经变成根组件的第一个真实 Dom 节点了，
     也就是`id=“root”`的 div 元素了，这次`patch`进入的子逻辑应该是`processElement`函数了：

     ```ts
     // runtime-core/renderer.ts
     const processElement = (...) => {
         isSVG = isSVG || (n2.type as string) === 'svg'
         if (n1 == null) {
           // 挂载元素
           mountElement(...)
         } else {
           // 更新元素
           patchElement(...)
         }
       }
     ```

     `processElement`基本上也是分发挂载和更新逻辑的一个函数，我们直接跳到同文件的`mountElement`函数：

     ```ts
     const mountElement = (
       vnode: VNode,
       container: RendererElement,
       anchor: RendererNode | null,
       parentComponent: ComponentInternalInstance | null,
       parentSuspense: SuspenseBoundary | null,
       isSVG: boolean,
       optimized: boolean
     ) => {
       let el: RendererElement;
       let vnodeHook: VNodeHook | undefined | null;
       const {
         type,
         props,
         shapeFlag,
         transition,
         scopeId,
         patchFlag,
         dirs,
       } = vnode;
       // 创建div元素
       el = vnode.el = hostCreateElement(
         vnode.type as string,
         isSVG,
         props && props.is
       );
       // 文本节点的children
       if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
         // 直接设置
         hostSetElementText(el, vnode.children as string);
       } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
         // 数组型的children
         mountChildren(
           vnode.children as VNodeArrayChildren,
           el,
           null,
           parentComponent,
           parentSuspense,
           isSVG && type !== "foreignObject",
           optimized || !!vnode.dynamicChildren
         );
       }

       // 设置props
       if (props) {
         for (const key in props) {
           if (!isReservedProp(key)) {
             hostPatchProp(
               el,
               key,
               null,
               props[key],
               isSVG,
               vnode.children as VNode[],
               parentComponent,
               parentSuspense,
               unmountChildren
             );
           }
         }
       }
       // 插入到容器元素中
       hostInsert(el, container, anchor);
     };
     ```

     函数中的生命周期 hook 相关的内容我都去除了，只剩下核心的四部逻辑：

     > 1. 依据元素类型使用平台创建元素函数创建`el`
     > 2. 分情况处理`children`
     > 3. 处理`Props`
     > 4. 将元素插入 Dom 中

     `hostCreateElement`底层是调用了`createElement`，针对`children`不同的情况有逻辑分支，我们需要关注的主要在`mountChildren`中的逻辑。

     ```ts
     const mountChildren: MountChildrenFn = (
       children,
       container,
       anchor,
       parentComponent,
       parentSuspense,
       isSVG,
       optimized,
       start = 0
     ) => {
       for (let i = start; i < children.length; i++) {
         // 规范化VNode
         const child = normalizeVNode(children[i]);
         // 直接patch
         patch(
           null,
           child,
           container,
           anchor,
           parentComponent,
           parentSuspense,
           isSVG,
           optimized
         );
       }
     };
     ```

     `mountChildren`对于`children`直接采用遍历的方式来逐个`patch`这样也产生了递归关系，
     接下来我们看看`hostPatchProp`这个方法来自 `runtime-dom/patchProp.ts`中，都是一些关于原生 Dom 元素的属性的操作就不再展开。
     当当前的元素生成后就是插入 Dom 的时机了，调用的也是 web 平台的`insertBefore`或者`appendChild`；
     感兴趣的可以在 `runtime-dom/(nodeOps|patchProp).ts`中详细了解`Web平台`相关的渲染 API。

  ## 整体流程图

  ![mount流程](/vue3-analysis/runtime/vue3-mount.jpg)

  整个流程也并不是特别复杂，重点在于`组件VNode`的创建、`组件Instance`的创建、组件子树的渲染逻辑、普通元素的处理及其 children 的挂载这些问题在流程上的顺序和关系，
  大可以通过在特定的函数中类似：`mountComponent`、`mountElement`和组件`instance`、`subTree`的创建函数中打上`debugger`跟着流程走一遍更加利于理解。

  ## 总结

  终于是攻克了组件挂载的流程了，看起来复杂的代码在一步步的调试和解析下也越来越清晰，我们关注主线选择性的忽略一些代码分支更加利于我们理解程序，
  里面还有很多可以深入学习的细节末枝，也可以等到后面解析更多具体的特性时再解析，下一篇我们将讲解组件的更新流程以及`Diff算法`。
