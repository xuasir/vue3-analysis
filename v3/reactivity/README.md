### **前言**  
这一篇章我们将会开启对`reactivity`包的解析，这也是`Vue`中非常重要的响应式系统的实现，
得益于`Vue3`的架构升级，`reactivity`从组件的内部分离出来，独立成一个响应式的库，
现在我们阅读起源码也轻松了不少。

## 目标  
本篇章以`reactive`、`ref`以及`effect`和`watchEffect`为核心方法讲解，
`Vue3`响应式系统的依赖收集和派发更新如何通过`proxy`来处理的；
对于`computed`、`watch`等等`API`划分到`future方法`中讲解。