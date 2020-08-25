### 工作在视图层
我们一直在讨论`Vue`是工作在视图层的一个框架，它带来了新的思考用户界面的方式，还有它的响应式系统和模板系统等等，
那么在`Vue`的架构中到底都包含什么样的组成模块他们又是怎么样协同合作的呢？

其实在`Vue2.x`和`Vue3.x`的版本更新中，`Vue`的核心模块其实是没有大变化的；
我们直接从`Vue3.x`的`mononrepo`分包中可以得到一些有效信息，`Vue`的核心可以分成如下几个部分
> 1. `reactivity`响应式系统  
> 2. `runtime`运行时系统  
> 3. `complier`编译器系统  

## `reactivity`响应式系统  
响应式系统是`Vue`的核心特性，它负责处理响应式对象相关的创建和依赖追踪；从编写代码的角度来说
响应式对象它相应的访问和修改与普通对象并无差异，这很大程度上降低了我们使用上的复杂度；当我们像普通对象一样修改响应式对象时，
视图就会自动更新，这使得我们能够更加专注在构建响应式状态和用户界面的关系上。  

我们都知道响应式对象的工作主要包含了依赖收集和派发更新两个部分，这其实对应了响应式对象数据的`getter/setter`两个操作，
而通过[Object.defineProperty](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty)
可以将`data options`中的属性和状态转化成自定义`getter/setter`，这些`getter/setter`对于使用者来说是不可感知的，
但是却在内部很好的完成了依赖收集和派发更新的职能(`Vue2`原理)。
::: tip 
1. 依赖收集——组件（模板系统）访问到了响应式对象的某个属性，就可以看做依赖这个属性，
而依赖收集做的就是将某个方法所依赖的所有响应式对象属性都收集起来。  
2. 派发更新——如果某个响应式对象属性发生了修改，则会通知依赖该响应式对象属性的组件（模板系统）重新渲染。
:::
更具象的来说，如同下图所示(`Vue2`原理)：
![reactivity](/vue3-analysis/idea/reactivity.png)
每个组件都对应着一个`watcher`实例，它会在组件渲染过程中（`render`函数执行）将访问到的响应式对象当做依赖收集；
在对应`setter`触发时，又通过`watcher`来重新触发组件的渲染。我们注意到依赖收集和派发更新的过程都是以组件为最小单位的，
这也是`Vue`性能上的优势——组件级别的更新。

#### 痛点：
由于`Object.defineProperty`的限制在`Vue2.x`中其实也是有如下问题的：  
* 我们必须要将普通`JavaScript`对象放置到`data`选项中才能变成响应式对象
* 对于响应式对象动态的添加和删除属性不会被收集
* 对于数组通过下标访问不能被响应式的监听到
* 引入`$set`和`$delete`这样的`API`，使用者需要额外的心智负担。
* 虽然在之后`Vue2.6.0`中提供了`Vue.observable`这样的更底层的响应式对象创建方式，但是却还是局限于`Vue2.x`的`options API`
（只能通过计算属性来集成到组件内部或者使用在渲染函数中）

在`Vue3`中使用[proxy](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Proxy)
替代`Object.defineProperty`的方案很好的解决了上述问题，对于`Vue3`来说响应式的工作模式本质上是没有变更的，
但是新的语法使得响应式系统本身更加完备，`reactivity`包也暴露了更多底层的响应式`API`，并且使得状态和行为的抽离封装有了可依赖的底层支持。  
> 得益于包架构的升级，[reactivity](https://github.com/vuejs/vue-next/tree/master/packages/reactivity)已经可以作为一个响应式库独立使用。

## `runtime`运行时系统  
在上文讲解响应式系统的依赖收集和派发更新时，不可避免的提及了组件、`render`函数、`virtual dom tree`等概念，
这其实正是`runtime`系统需要负责的内容。  
#### 核心工作：
* 创建平台相关的渲染器
* 提供组件系统
* 提供`dom diff`能力

运行时的整体能力上与`Vue2`相似，但是`Vue3`的代码`runtime-core`和`runtime-dom`的耦合度更低，不同平台渲染器创建成本更低。
这是一段`Vue3`的初始化代码（web平台）：
```JavaScript
Vue.createApp(App).mount('#app')
```
当我们调用`CreateApp`时其实就是在创建一个`web`平台渲染器，当我们执行`mount`时，
是在触发从根组件开始的`render`流程（执行根组件的`render`函数）来构建`virtual dom tree`最终生成真实`dom`来挂载到`#app`节点；
在更新流程中由于`Vue`的更新是组件级别的，我们直接从有依赖触发的组件为更节点来重算新的`virtual dom tree`，然后进行新旧`virtual dom tree`
的`diff`对比，以映射到真实`dom`的最小更改。

#### 异步的更新队列
在`Vue`中**Dom**的更新是异步的，只要数据变化了，`Vue`就会开启一个缓冲队列来缓冲同一事件循环中的更新请求，
同一个组件多次被触发更新将会被去重来确保不重复更新，这对于去除不必要的重复计算和`dom`操作是很有效的。
得益于响应式系统依赖收集的准确性和`Vue`没有像`React`中`Fiber`那样的可中断的依赖于浏览器空闲时间的复杂调度。

## `complier`编译器系统  
编译器系统可以说是服务于`runtime`系统的，它负责将模板编译成`render`函数，其中会做大量的优化标记信息提供给`runtime`，
使得运行时`dom diff`的效率增高，可以说响应式系统将`Vue`的更新变成组件级别，
`complier`的静态标记优化使得`Vue`的更新成为点对点级别的更新，能够跳过更多不必要的比对。  
下面是使用[vue-next-template-explorer](https://vue-next-template-explorer.netlify.app/)展示的一段`Vue3 complier`优化的代码：
```html
<div>
  <span>a</span>
  <span @click="add">{{ msg }}</span>
  <span @click="add">a</span>
  <span>{{ msg1 }}</span>
</div>
```
```JavaScript
import { createVNode as _createVNode, toDisplayString as _toDisplayString, openBlock as _openBlock, createBlock as _createBlock } from "vue"

export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createBlock("div", null, [
    _createVNode("span", null, "a"),
    _createVNode("span", { onClick: _ctx.add }, _toDisplayString(_ctx.msg), 9 /* TEXT, PROPS */, ["onClick"]),
    _createVNode("span", { onClick: _ctx.add }, "a", 8 /* PROPS */, ["onClick"]),
    _createVNode("span", null, _toDisplayString(_ctx.msg1), 1 /* TEXT */)
  ]))
}
```
在`Vue3`中提出了一个`patchFlag`的概念，在模板编译阶段尽量标记出动态内容提供给`runtime`更加准确快速的`patch`目标；
我们可以看到在`_createVNode`的第四个参数会传递一个`patchFlag`，通过注释就可以看到编译器已经准确的扫描出该`VNode`的动态内容，
在`runtime`的时候我们即可只进行`props`或者`text`的`patch`节省了很多开销；类似的优化项目还有很多比如`cacheHandlers`、`hoistStatic`等等内容，
可以在**vue-next-template-explorer**中调试观察。

## 总结
分析了三个核心模块的主要职能后，其实三者的关系已经很清晰了：  
* `complier`系统负责模板的编译服务于`runtime`系统
* `runtime`系统主要负责组件到`virtual dom tree`再到`dom`的更新和挂载流程
* `reactivity`系统负责提供响应式数据的创建和依赖收集
* `runtime`和`reactivity`的协作，也是依赖于组件级别的依赖收集

**Vue**基于响应式系统来驱动模板系统，这样的组合使得数据驱动视图成为可能，因为在依赖收集完成的情况下，
数据的变更总是会引起`virtual dom tree`的重算，最终反映出来的也是视图的更新。我们从**Vue**的内核了解了**Vue**是如何
构建一套拥有响应式特色的**UI**描述方式的，接下来我们再回过头来看一看**UI**是什么？