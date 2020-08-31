### createApp流程

## 本篇目标

1. 了解`createApp`背后都做了什么？
2. `custom render API`是如何从`runtime-core`逻辑中分离

## 解析

`createApp`应该是用户最早能看到的`API`之一，不同于`Vue2.x`采用`new Vue({...})`的方式来生成根组件，`Vue3`采用了更函数式的调用方式：

```js
// vue2.x
new Vue({
	render: h => h(App)
}).$mount('#app');
// vue3
createApp(app).mount('#app')
```

对比就可以看到`Vue3`的调用方式更加简洁，那么`createApp`的背后究竟做了什么呢？

## `createApp`概览

我们来到`createApp`声明的文件位置`runtime-dom/src/index.ts`通过搜索可以找到`createApp`的函数声明，
通过`typescript`的函数类型声明可以看到`createApp`是实现了一个`CreateAppFunction<Element>`的类型，找到该类型的声明如下：

```typescript
// runtime-core/src/apiCreateApp
export type CreateAppFunction<HostElement> = (
	// 根组件
  rootComponent: PublicAPIComponent,
  // 根组件props
  rootProps?: Data | null
) => App<HostElement>
```

可以看到`createApp`接受两个参数根组件和组件`props`返回`App`实例，这里的`App`实例接口可以展示一下：

```typescript
// runtime-core/src/apiCreateApp
export interface App<HostElement = any> {
  // 版本信息
  version: string
  // 全局的app配置
  config: AppConfig
  // 插件use方法
  use(plugin: Plugin, ...options: any[]): this
  // 混入方法
  mixin(mixin: ComponentOptions): this
  // 组件相关函数重载
  // 获取
  component(name: string): PublicAPIComponent | undefined
  // 注册
  component(name: string, component: PublicAPIComponent): this
  // 指令相关函数重载
  // 获取
  directive(name: string): Directive | undefined
  // 注册
  directive(name: string, directive: Directive): this
  // 挂载方法
  mount(
    rootContainer: HostElement | string,
    isHydrate?: boolean
  ): ComponentPublicInstance
  // 卸载方法
  unmount(rootContainer: HostElement | string): void
  // 注入方法
  provide<T>(key: InjectionKey<T> | string, value: T): this

  // internal, but we need to expose these for the server-renderer and devtools
  // 根组件
  _component: Component
  // 根组件props
  _props: Data | null
  // 挂载容器
  _container: HostElement | null
  // app上下文
  _context: AppContext
}
```

这些方法或者属性会是将来常用的全局`API`稍微眼熟一下。  

通过`createApp`的类型声明可以了解到`createApp`函数的主要职能是接受`app`组件创建返回`app`实例。

## `createApp`内部实现

回到`createApp`的函数体内部，可以发现`createApp`主要做了如下几件事情：

```typescript
// runtime-dom/index.ts
export const createApp = ((...args) => {
  // 创建渲染器并调用渲染器的createApp方法创建app实例
  const app = ensureRenderer().createApp(...args)
  // 重写app的mount方法
  const { mount } = app
  app.mount = (containerOrSelector: Element | string): any => {
    // ......
  }
  // 返回app
  return app
}) as CreateAppFunction<Element>
```

我们依次查看各个步骤内部所做的事情，再回头讨论`createApp`中为什么要做这几件事情。

- #### 创建渲染器

> 来到函数`ensureRenderer`中还是很简单的一个单例模式：

 ```ts
 // runtime-dom/index
 function ensureRenderer() {
 	//  存在即直接返回，不存在就创建
   return renderer || (renderer = createRenderer<Node, Element>(rendererOptions))
 }
 ```

> 这里传递了一个`renderOptions`作为参数，是非常重要的一点，
  这个`options`中包含了web平台的相关的dom操作以及非常重要的`patchProp`这也是`custom render API`的核心所在，
  这里具体的内容我们放在最后去探究，暂时先关注在整个核心流程上。
  我们来到这个的位置：`runtime-core/renderer.ts`，找到`createRenderer`函数：

 ```ts
 // runtime-core/renderer.ts
 export function createRenderer<
   HostNode = RendererNode,
   HostElement = RendererElement
 >(options: RendererOptions<HostNode, HostElement>) {
   return baseCreateRenderer<HostNode, HostElement>(options)
 }
 ```

> 这里能看到在`createRenderer`中又返回了一个`baseCreateRenderer`并且将options作为参数传入，该函数的内部实现如下：

 ```ts
 // runtime-core/renderer.ts
 function baseCreateRenderer(
   options: RendererOptions,
   createHydrationFns?: typeof createHydrationFunctions
 ): any {
     // 从options中拿出宿主平台的api
     const { ... } = options
     // 创建渲染函数
     const render: RootRenderFunction = (vnode, container) => {
       if (vnode == null) {
         if (container._vnode) {
           unmount(container._vnode, null, null, true)
         }
       } else {
         patch(container._vnode || null, vnode, container)
       }
       flushPostFlushCbs()
       container._vnode = vnode
     }
    // 返回渲染器对象
    return {
     render,
     hydrate,
     createApp: createAppAPI(render, hydrate)
   }
 }
 ```

> 整体来说`baseCreateRenderer`所做的事情也就包含了：
>
> 1. 从`options`中取出平台相关的API
> 2. 声明`patch`和`patch`的子过程函数
> 3. 声明`render`函数
> 4. 返回一个渲染器对象
>
> 这个函数中的细节会在之后的挂载和更新流程中频繁使用，等到具体的部分再来解析细节。
目前看到这里`baseCreateRenderer`执行完毕后我们应该是已经得到渲染器并且返回到`createApp`函数当中了。

 ```ts
 const app = ensureRenderer().createApp(...args)
 ```

> 紧接着我们应该是将`createApp`的入参悉数传递到渲染器的`createApp`函数中并且调用得到app实例。

- #### 创建app实例

> 首先我们还得回到文件：`runtime-core/renderer.ts`找到`baseCreateRenderer`函数最后返回的部分:

 ```ts
 // runtime-core/renderer.ts
 //....
 return {
 render,
 hydrate,
 createApp: createAppAPI(render, hydrate)
 }
 //....
 ```

> 我们在`createApp`中调用的渲染器的`createApp`方法是来自这个`createAppAPI`所返回的，
  找到文件：`runtime-core/apiCreateApp.ts`中找到了`createAppAPI`函数的声明如下：

 ```ts
 // runtime-core/apiCreateApp.ts
 export function createAppAPI<HostElement>(
   render: RootRenderFunction,
   hydrate?: RootHydrateFunction
   ): CreateAppFunction<HostElement> {
   // 再次返回一个函数，是为了通过柯里化的技巧将render函数以及hydrate参数持有，避免了用户在应用需要传入render函数给createApp
   return function createApp(rootComponent, rootProps = null) {
    // 创建app上下文
    const context = createAppContext()
    // 创建插件安装set
    const installedPlugins = new Set()
    // 是否挂载
    let isMounted = false
    // 通过对象字面量俩创建app实例
    // 实现了上文app实例的接口
    const app: App = (context.app = {
      _component: rootComponent as Component,
      _props: rootProps,
      _container: null,
      _context: context,
      version,
      get config() {
        return context.config
      },
      set config(v) {},
      use(plugin: Plugin, ...options: any[]) {},
      mixin(mixin: ComponentOptions) {},
      component(name: string, component?: PublicAPIComponent): any {},
      directive(name: string, directive?: Directive) {},
      mount(rootContainer: HostElement, isHydrate?: boolean): any {
        if (!isMounted) {
          const vnode = createVNode(rootComponent as Component, rootProps)
          vnode.appContext = context
          render(vnode, rootContainer)
          isMounted = true
          app._container = rootContainer
          return vnode.component!.proxy
      },
      unmount() {
        render(null, app._container)
      },
      provide(key, value) {}
    })
 
    return app
   }
 }
 ```

> 由此可见`createAppAPI`主要做的事情还是比较简单的：
>
> 1. 通过`createAppContext`创建app上下文
> 2. 创建已安装插件缓存`set`和`isMounted`app是否挂载标识
> 3. 通过对象字面量的方式创建了一个完全实现app实例接口的对象并且返回出去
>
> `createAppContext`这个子过程也是非常简单的代码：

 ```ts
 export function createAppContext(): AppContext {
   return {
     // app实例
     app: null as any,
     // 全局配置
     config: {
       // 是否为原生标签
       isNativeTag: NO,
       performance: false,
       // 全局属性
       globalProperties: {},
       // 配置合并策略
       optionMergeStrategies: {},
       // 是否为自定义元素
       isCustomElement: NO,
       // 错误处理函数
       errorHandler: undefined,
       // 警告处理函数
       warnHandler: undefined
     },
     // 全局混入
     mixins: [],
     // 全局组件
     components: {},
     // 全局指令
     directives: {},
     // 全局注入
     provides: Object.create(null)
   }
 }
 ```

> `createAppAPI`的整个过程也就结束了，期间的通过函数柯里化技巧保存render等信息的方法是一大亮点，
  整个过程分析的也不算难，我们再次回到用户调用的`createApp`中现在已经到达了重写mount方法的阶段了。
  
- #### 重写mount

> 我们直接看整个重写的过程：

 ```ts
 // 重写app的mount方法
   const { mount } = app
   app.mount = (containerOrSelector: Element | string): any => {
     // 规范化容器元素 element | string --> element
     const container = normalizeContainer(containerOrSelector)
     // 找不到元素则直接return
     if (!container) return
     // 拿到app组件
     const component = app._component
     // 如果既不是函数组件也没有render和模板则取容器元素的innerHTML当做模板
     if (!isFunction(component) && !component.render && !component.template) {
       component.template = container.innerHTML
     }
     // 在挂载前清空容器的innerHTML
     container.innerHTML = ''
     // 执行挂载 得到返回的代理对象
     const proxy = mount(container)
     return proxy
   }
 ```

> 整个过程是以处理容器元素、确保根组件存在模板或者渲染函数、清空容器内容这三部才做来确保原mount函数的正常执行。

## 整体流程图

![createApp](/vue3-analysis/runtime/vue3-createApp.jpg)

上图就是整个 `Vue3.createApp(app)`的全流程了，思路非常清晰。

## 填坑

- #### 为什么`Vue3`要在`createApp`的阶段进行渲染器的创建？

 > `Vue3`现在采用了分包的措施，存在用户仅需要使用`reactivity`包的情况，这时候延时创建渲染器的意义就体现了，
 当用户只引用`reactivity`包的时候就不会创建渲染器，因为渲染器是在`runtime`创建的，这样也就能通过`tree shaking`来去除不需要的渲染相关代码。

- #### 为什么要在`createApp`中将`mount`方法重写？

 > 将重写`mount`处理的逻辑和渲染器`mount`分离，也强调了渲染器的单一职责性，这也是`Vue3`将`runtime`拆分成`core`和`dom`两个包的初衷，
 重写的逻辑基本上是处理平台相关的内容比如：处理容器元素、清空容器内容，这也是在`web`平台下特有操作，如果放在渲染器的`mount`中这就是一种冗杂，让渲染器不再纯粹的关注渲染相关。

- #### `custom render API`是如何实现的？

 > `custom render API`基本的能力来源于，延时创建渲染器时`renderOptions`的动态传入以及`createApp`能对`mount`方法进行重写。因此`custom render API`也能分成两个部分：
 >
 > 1. 挂载阶段的准备工作
 > 2. 挂载渲染阶段需要的对平台进行增删改查的基本API
 >
 > 第一点算是很简单的了，在代码中也是很容易理解。
 >
 > 第二点关于`renderOptions`可直接看`interface`即可：
 >
 ```ts
 // runtime-core/renderer.ts
 export interface RendererOptions<
   HostNode = RendererNode,
   HostElement = RendererElement
 > {
   // diffprops的函数
   patchProp(
     el: HostElement,
     key: string,
     prevValue: any,
     nextValue: any,
     isSVG?: boolean,
     prevChildren?: VNode<export interface RendererOptions<
   HostNode = RendererNode,
   HostElement = RendererElement
 > {
   // diffprops的函数
   patchProp(
     el: HostElement,
     key: string,
     prevValue: any,
     nextValue: any,
     isSVG?: boolean,
     prevChildren?: VNode<HostNode, HostElement>[],
     parentComponent?: ComponentInternalInstance | null,
     parentSuspense?: SuspenseBoundary | null,
     unmountChildren?: UnmountChildrenFn
   ): void
   // 强制patchprops
   forcePatchProp?(el: HostElement, key: string): boolean
   // 插入方法
   insert(el: HostNode, parent: HostElement, anchor?: HostNode | null): void
   // 移除方法
   remove(el: HostNode): void
   // 创建元素方法
   createElement(
     type: string,
     isSVG?: boolean,
     isCustomizedBuiltIn?: string
   ): HostElement
   // 创建文本方法
   createText(text: string): HostNode
   // 创建注释方法
   createComment(text: string): HostNode
   // 设置文本方法
   setText(node: HostNode, text: string): void
   // 设置元素文本内容方法
   setElementText(node: HostElement, text: string): void
   // 查找父元素的方法
   parentNode(node: HostNode): HostElement | null
   // 查找下一个兄弟元素的方法
   nextSibling(node: HostNode): HostNode | null
   // 静态选择器
   querySelector?(selector: string): HostElement | null
   setScopeId?(el: HostElement, id: string): void
   // 克隆元素
   cloneNode?(node: HostNode): HostNode
   // 插入静态节点的方法
   insertStaticContent?(
     content: string,
     parent: HostElement,
     anchor: HostNode | null,
     isSVG: boolean
   ): HostElement[]
 }
 ```
 
> 整体包含这么多个相关的方法，由此可见写一个新的平台相关的接口接入`Vue3`并不是一件复杂的事情，
这会给以后的跨平台开发类库的开发者接入`Vue3`的体验带来前所未有的提升；
我们也期待像`uni-app`、`weex`等类库在`Vue3`能将开发体验提升到什么样的层次。

## 总结

整体上来说 `createApp`的全流程并不算复杂，其中也有很多细节并未提到，感兴趣的小伙伴可以深入研读。
再次回到本篇的目的，经过本篇的解析相信应该是都已有答案了。

