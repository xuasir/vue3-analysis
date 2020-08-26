### UI是什么
此前我们一直在讨论**Vue**是如何构建用户界面，**Vue**都做了什么来支撑它的**UI**构建方式的；
现在我们反过来思考一下：在`Vue3`加持下**UI**是什么？

## 仅仅是数据到视图的映射吗
我们在前文中提到过一个表达**UI**的方式：

> UI = f(data)

但是仅仅数据映射到**UI**能够表达全部吗？  

> [列表项1, 列表项2, ...] --> 列表  

展示一个列表似乎很容易用数据映射来表达的，但是如果我们产生了一些行为，比如添加一项列表项，行为如何来表达呢？
在`Vue`中我们可以通过某个方法来改变列表数据以表达添加一项的行为，其实这样思考的时候就已经符合`Vue`的数据驱动思想；
我们知道这个方法是用来修改列表数据的，那就说明这个数据是可变的是隐含了一系列与之相关的行为在背后的，
那么我们应该做的就是从数据中分离出这样的一个可变数据的概念——状态，用来对应行为，而不可变的数据当做属性传递到视图；
此时我们将数据拆分成状态和属性，并且添加行为就可以得到一个如下的模型：  
![UI](/vue3-analysis/idea/UI.jpg)  
这也是一个单向数据流的模型，`Vue`也是一直在强调单项数据流准则的；可能很多人会说`Vue`中有双向绑定不是单项数据流，
但是双向绑定只是模板系统下的一个语法糖，本质上还是符合行为到状态再到视图的单向数据流。  
由于`Vue`的响应式特性，我们看到的状态和改变状态的行为本就是一体的，实际上改变状态的行为的确是可以被状态包含的，
状态是可变的它代表了状态在将来可能出现的所有的值都被包含进来，那改变状态的行为就已经被包含在状态之中了，
这样视图就不需要感知行为了它仅需要感知状态;因此我们很容易就将行为和状态简化到一起，这样**UI**就成了视图和状态的循环：  
![UI loop](/vue3-analysis/idea/UI-loop.jpg)  
这样的表述还是不够，我们依旧无法描述`setTimeout`、`console.log`和`location.href`等等并不作用于状态却又真实存在的行为，
比如用户未登陆就跳转到登录页，用户登录是一个状态，`location.href`的跳转并没有改变这个状态但是它改变了视图，这种行为应该别如何定义呢？
所以还需要引入作用的概念；如果我们统一理解，将状态理解成状态行为，作用也理解成一种行为，那么我们能够得到如下的对视图的描述：  
![UI relation](/vue3-analysis/idea/UI-relation.jpg)  
真正与视图耦合的只有属性，其他的状态、上下文、作用等等都变成与视图关联的一部分；如果我们将状态行为、上下文、作用行为耦合到视图内部，
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
这便是`composition API`为我们提供的新的描述**UI**的方式，我们如何封装一个状态与行为呢？  
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
如果有一百个组件需要鼠标坐标状态，我们都仅需要声明一个逻辑块；这就是松散的组合关联关系带来的可复用性。
而且鼠标坐标的状态显然就包含了更改它的行为，这与我们之前的结论相互印证。

## 总结
我们详细的讨论了`Vue3 composition API`下，**UI**是什么；
明白了在`Vue3`中需要做的也是将不同种类、不同领域的状态及其行为进行抽离封装，最终于视图形成的只是松散的关联组合关系；
我相信这已经很透彻的说明了在`composition API`下我们应该如何构建用户界面。

## 参考
* [组合式 API 征求意见稿](https://composition-api.vuejs.org/zh/#%E4%BB%A3%E7%A0%81%E7%BB%84%E7%BB%87)  
* [React hooks实战指南](https://www.bilibili.com/video/BV1Ge411W7Ra)
