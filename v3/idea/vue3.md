### Vue3的升级
`Vue3`的升级可是说是外部看起来没有大的变化，内部却早已经焕然一新；除了`composition API`外剩下的更新可能都不太是能表现在`API`层面的。
我们要从以下几个方面来具体谈谈。  

## 架构升级
首先要说的其实就是架构的升级，采用`monorepo`来管理项目，拆分了`reactivity`、`runtime`和`complier`三个模块出来（`ssr`相关和`sfc`相关的不在讨论范围内），
各个模块职责更加分明，`API`设计、测试用例也更加独立，各个模块之间耦合度变低，依赖关系和方式也更加明确；
再加上采用`typescript`完全重写，这就带来的自身维护性的提升。

#### * `reactivity`
拆分出来的`reactivity`更加专注于实现响应式，从`Vue2`与组件`watcher`耦合的模式变成以函数单元来收集依赖，更加通用独立。

#### * `runtime`
架构升级为`runtime`带来的主要影响是隔离了`core`和`dom`，通过`custom renderer API`来交互。

#### * `complier`
编译器除了服务于`runtime`的优化，同时也将编译过程的一些特性处理函数化、插件化，提升了扩展能力。

##  `Object.defineProperty`到`proxy`
首先从`API`本身来说`proxy`的浏览器厂商优化做得就比`Object.defineProperty`更加好，这已经包含了性能的提升；
但是`API`变更带来的更加重要的提升是源于`proxy`是一个真正的对于原对象的代理，
而不是像`Vue2`时代需要递归遍历`data`中的所有层级数据并且一一设置`setter/getter`；
`proxy`的代理默认是一层浅代理，将递归代理深层次属性的过程放在了`getter`阶段，也就意味着我们初始化响应式数据的性能会提升。
当然`proxy`也是有兼容性问题的——作为一个新的语法无法在浏览器端被`polyfill`，在`Vue3`的正式版中是会有底层降级的兼容版本。

##  重写`virtual dom`以及编译时优化
新版本采用了`typescript`重写了`virtual dom`，在`diff`算法上也采用了新的策略；并且加入了很多的编译时优化像是`cacheHandlers`、`hoistStatic`等等，
同时为每个`vnode`打上`patchFlag`已提供更好的运行时有效信息。  
针对传统`virtual dom`的需要深度对比的性能瓶颈（单个组件内部），提出了`block`的概念，以最小静态块提取动态内容，达到点对点直接对比，避免了不必要的遍历；
为什么`Vue3`要花这么大的代价来保留`virtual dom`而不像`angular lvy`那样直接将模板编译成`dom`操作的指令集呢？究其原因是`Vue`不想摈弃`virtual dom`带来的表现力，
想要达到向下能兼容高级场景的手写`render`需求，向上也能通过模板优化获取一个较好的运行时性能。

##  函数化
这里的函数化不是仅指`composition API`的函数化，也是在指内部的函数化。  

#### * 内部函数化
我们都知道`Vue2`是十分依赖`this`的，所有的`data`、`methods`、`computed`等等都需要一一在`this`上进行挂载；
针对这点`Vue3`的组件创建不再通过`new`一个`Vue`的实例，而是通过对象字面量的方式；`render`函数执行不再依赖`this`，
而是通过一个`proxy`来搞定，`proxy`本身就可以实现使用时再获取，同时也不需要预先进行所有属性方法的逐个`define`，是真正的`getter`访问原数据；
这些优化都提升了组件启动的性能。  

#### * `API`的函数化
更加函数化的`composition API`不仅在`typescript`支持上更加友好，同时提供了更加灵活的逻辑组合能力；
摆脱了`options API`相关逻辑内容无法很好地聚合在一起需要在`data`、`methods`等等选项中来回切换的问题，
同时`functional`的逻辑封装客观上更容易使用`import`来导入，在`tree shaking`和逻辑复用方面也是更加的灵活；
所有的内部`API`都通过`vue`来导出也能更好地支持`tree shaking`；
函数化的代码也更加容易压缩，函数作用域内的变量名都能被安全的智能压缩。
这些优化提升使得`Vue`体积能够在`13.5kb`到`22.5kb`之间伸缩。  

## 总结
`Vue3`从自身可维护性、性能和大型应用的逻辑复用问题出发，做了深度的优化处理；在经历了`class API`推翻到`function-based API`，
同时还对`virtual dom`和编译器进行重写，尤大对细节的极致追求造就了现在的`Vue3`形态，让我们在接下来的内容中慢慢解开这背后的实现细节。