### UI是什么
此前我们讨论到数据驱动视图时，得到了视图即数据的一种映射的结论，这一篇我们更加详尽的来讨论一下：在`Vue3`加持下**UI**是什么？

## 仅仅是数据到视图的映射吗
我们在前文中提到过一个表达**UI**的方式：

> UI = f(data)

#### * 但是仅仅数据映射到**UI**能够表达全部吗？  

> [列表项1, 列表项2, ...] --> 列表  

展示一个列表似乎很容易用数据映射来表达的，毕竟我们拥有结构型指令`v-for`这样的映射关系，
但是在用户界面上，我们不只有数据到视图的数据流，同时我们也有用户交互触发的行为到数据的流向；
仅仅数据到视图的映射显然是不够的，我们需要建立如下的单向数据流模型：  

![UI-single](/vue3-analysis/idea/UI-single.jpeg)  

我们加入了一个行为的概念来描述来自视图的行为数据流，这里的行为包含了同步和异步两种，异步的行为是时间轴上的异步，
最终还是要对应到数据上才能处于当前的单项数据流闭环中，不映射到数据上的行为那是另外的概念了，后面会提到。

#### * 数据都对应着行为吗？  
显然对于我们的一个`Vue`组件来说传入的`props`属性是无法在当前组件中被更改的，那行为就无法对应到属性上；
既然数据不是都对应着行为，那我们还需要重新定义数据；将不可变的部分拆分成属性，可变的用来对应行为的拆分为状态：  

![UI](/vue3-analysis/idea/UI.jpg)  

#### * 状态是否包含了行为？  
由于`Vue`的响应式特性，我们看到的状态和改变状态的行为本就是一体的，我们想要改变状态直接赋值修改即可；
这里如果我们使用`React`的`setState`来理解改变状态的行为会更加具象，也就是说`state`是否包含了每一次的`setState`？
实际上改变状态的行为的确是可以被状态包含的，其实我们不应该在将状态理解成一个值，而应该理解成一个包含了未来所有可能出现值的集合，
就如同流一样，看起来像一个数据，其实它背后拥有一个时间相关的轴它包含了未来所有可能出现的值，影射了改变流的行为。
如果行为能被封装到状态的背后，这样视图就不需要感知行为了它仅需要感知状态;
因此我们很容易就将行为和状态简化到一起，这样**UI**就成了视图和状态的循环：  

![UI loop](/vue3-analysis/idea/UI-loop.jpg)  

#### * 作用于状态和视图之外的行为是什么？  
这样的表述还是不够，我们依旧无法描述`setTimeout`、`console.log`和`location.href`等等并不作用于状态却又真实包含在视图描述中的行为，
比如用户未登陆就跳转到登录页，用户登录是一个状态，`location.href`的跳转并没有改变这个状态但是它改变了视图，这种行为应该被如何定义呢？
所以还需要引入作用的概念；如果我们统一理解，将状态理解成状态行为，因为改变状态本身就是一种用户行为；
作用也理解成一种行为，`console.log`打印日志、`location.href`跳转本身也是一种行为；
那么我们能够得到如下的对视图的描述：  

![UI relation](/vue3-analysis/idea/UI-relation.jpg)  

#### * 关联的关系
在最终我们的模型中真正传入视图的只有属性，其他的状态、上下文、作用等等都变成与视图关联的一部分；如果我们将状态行为、上下文、作用行为耦合到视图内部，
那我们就没有办法做到复用这些行为；而关联的关系正是`Vue3 composition API`所带给我们的组合特性。
再回到一开始的表达式，我们可以重新描述成如下形式：  

> UI = f(props) useComposable1, useComposable2 ...

**UI**变成了视图使用了组合1、组合2等等，组合可以是一类状态和行为的封装，也可以是上下文、作用等等内容；
至此我们再看一下`Vue3 composition API`的形态：  
```vue
<template>
  <div>{{ object.foo }}</div>
</template>

<script>
  import { reactive, watchEffect } from 'vue'

  export default {
    setup(props) {
      // 使用了状态 object
      const object = reactive({ foo: 'bar' })
      // 使用了作用 console.log
      watchEffect(() => console.log(object.foo))
      // 暴露状态给模板
      return {
        object,
      }
    },
  }
</script>
```
这便是`composition API`为我们提供的新的描述**UI**的方式，有属性、包含行为的状态、作用等等。

#### * `composition API`下我们如何封装一个状态与行为呢？  
```js
import { ref, onMounted, onUnmounted } from 'vue'

export function useMousePosition() {
  const x = ref(0)
  const y = ref(0)

  function update(e) {
    x.value = e.pageX
    y.value = e.pageY
  }

  onMounted(() => {
    window.addEventListener('mousemove', update)
  })

  onUnmounted(() => {
    window.removeEventListener('mousemove', update)
  })

  return { x, y }
}
```
```js
import { useMousePosition } from './mouse'

export default {
  setup() {
    const { x, y } = useMousePosition()
    // 其他逻辑...
    return { x, y }
  },
}
```
这是来自`Vue composition API RFC`官网的一个示例，封装了一个鼠标坐标的状态，视图使用了它就得到了它的状态；
如果有一百个组件需要鼠标坐标状态，我们都仅需要声明一个逻辑块；这就是松散的关联关系带来的可复用性。
而且在`useMousePosition`中鼠标坐标的状态显然就包含了更改它的行为，这与我们之前的结论相互印证。

## 总结
我们详细的讨论了`Vue3 composition API`下，**UI**是什么；同样的思考也能应用到`React hooks`上去，这也是一种殊途同归吧，
一个响应式数据、一个不可变数据最终却得到了相同的**UI**描述形态。
现在我们也明白了在`Vue3`中需要做的也是将不同种类、不同领域的状态及其行为进行抽离封装，最终与视图形成的只是松散的关联关系；
我相信这已经很透彻的说明了在`composition API`下我们应该如何构建用户界面；接下来我们可以看看`Vue`的内在了。

## 参考资料
* [组合式 API 征求意见稿](https://composition-api.vuejs.org/zh/#%E4%BB%A3%E7%A0%81%E7%BB%84%E7%BB%87)  
* [React hooks实战指南](https://www.bilibili.com/video/BV1Ge411W7Ra)
