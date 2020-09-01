### 异步任务调度  
相信在深度使用`Vue2`的时候会经常用到`$nextTick`这样一个`API`，也可能了解到了`vue`的组件更新是异步的，
这一节我们就会深入探讨`Vue3`异步任务调度的实现。在开始之前我们先回答一个问题，为什么组件的更新需要异步执行？  
我们先假设组件的更新是同步的，如果在一个`tick`（一次宏任务的周期）中组件所依赖的对个状态都发生了变更，
此时是同步执行更新的那么这个更新的流程会被触发多次，这有必要吗？显然我们可以等待当前`tick`完成后再去统一执行一次组件更新，
这样做我们即将所有的数据变更都应用了，也减少了很多不必要的重复执行；这样的一个当前`tick`执行完成后的时机就是微任务阶段，
这也是`Vue`异步任务调度的核心，缓冲当前`tick`的所有更新`trigger`，在微任务阶段一次执行完成；
异步调度存在的原因和实现思想我们都有所了解了，那让我们具体来看看代码实现吧。  

## 前置知识  
- [EventLoop](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/EventLoop)  
- [Promise](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise)  

- ## 基本任务队列设计  
在`Vue3`的异步任务调度设计中，有两种任务队列：  
```typescript
// runtime-core/scheduler.ts
// 异步任务队列
const queue: (Job | null)[] = []
// 异步任务队列执行完成后的异步回调队列
const postFlushCbs: Function[] = []
```
这两种队列的典型就是，组件更新通过异步任务队列来执行，指令的`updated`、组件的`updated`等等通过`postFlushCbs`来执行。  

- ## `nextTick`  
```typescript
// runtime-core/scheduler.ts
const p = Promise.resolve()
export function nextTick(fn?: () => void): Promise<void> {
  return fn ? p.then(fn) : p
}
```
`Vue3`的`nextTick`实现已经变得非常简单，直接采用`Promise.resolve().then()`来实现。  

- ## 入队操作  
- #### 1. 异步任务队列入队
```typescript
// runtime-core/scheduler.ts
// 当前执行异步任务的下标
let flushIndex = 0
// 是否在执行任务中
let isFlushing = false
// 是否在等待执行任务中（已有flushJobs被nextTick的情况）
let isFlushPending = false

export function queueJob(job: Job) {
  if (!queue.includes(job, flushIndex)) {
    queue.push(job)
    queueFlush()
  }
}
// 既没有执行任务也没有等待执行就添加任务到nextTick
function queueFlush() {
  if (!isFlushing && !isFlushPending) {
    isFlushPending = true
    nextTick(flushJobs)
  }
}
```
异步任务的入队直接查找当前执行任务之后的所有任务发现没有同一任务时任务入队；
这里需要`flushIndex`的原因是在异步任务执行的过程中也时可能会添加新的异步任务入队。
在`queueFlush`函数中，如果既没有执行异步任务执行中也没有在等待执行中，我们直接向微任务队列添加一个清空异步队列的任务。  

- #### 2. `postFlushCbs`队列入队  
```typescript
// runtime-core/scheduler.ts
// 执行中的异步回调队列
let pendingPostFlushCbs: Function[] | null = null
// 当前执行异步回调的下标
let pendingPostFlushIndex = 0

export function queuePostFlushCb(cb: Function | Function[]) {
  if (!isArray(cb)) {
    if (
      !pendingPostFlushCbs ||
      !pendingPostFlushCbs.includes(cb, pendingPostFlushIndex)
    ) {
      postFlushCbs.push(cb)
    }
  } else {
    // 如果是一个数组，说明是组件hooks函数，这只能被唯一的一个job触发添加
    // 无需再次去重，跳过以提升性能
    postFlushCbs.push(...cb)
  }
  queueFlush()
}
```
在没有执行异步回调队列或者剩余队列中不包含当前异步回调函数时入队。
同样的通过`pendingPostFlushIndex`的设计来考虑执行过程中添加异步回调任务的情况。  

- ## 执行队列  
- #### 1. 异步任务队列执行  
```typescript
// runtime-core/scheduler.ts
// 获取任务id
const getId = (job: Job) => (job.id == null ? Infinity : job.id)
// 执行任务
function flushJobs(seen?: CountMap) {
  // 设置成正在执行异步任务
  isFlushPending = false
  isFlushing = true
  if (__DEV__) {
    seen = seen || new Map()
  }
  // 将任务按id从小到大排列
  queue.sort((a, b) => getId(a!) - getId(b!))
  // 循环执行任务
  for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
    const job = queue[flushIndex]
    if (job) {
      if (__DEV__) {
        // 检测是否有循环更新
        checkRecursiveUpdates(seen!, job)
      }
      // 执行任务
      callWithErrorHandling(job, null, ErrorCodes.SCHEDULER)
    }
  }
  // 执行完毕,重置参数
  flushIndex = 0
  queue.length = 0
  // 执行异步回调任务队列
  flushPostFlushCbs(seen)
  isFlushing = false
  // 在任务执行过程中添加的任务，需要在当前微任务队列中一并执行完毕
  if (queue.length || postFlushCbs.length) {
    // 循环调用直达执行完毕
    flushJobs(seen)
  }
}
```
##### 1. 首先在开始执行之前会将相关状态设置成正在执行任务。  

##### 2. 任务排序  
任务排序的意义在于，我们要确保父组件的更新在子组件之前；同时也能在父组件的更新过程中确保如果卸载了子组件，可以跳过子组件的更新；
那么为什么排序就能实现这样的效果呢？  
我们知道组件的更新是执行副作用的渲染函数，这就涉及到`effect`创建的内容，
可以在后续的解析`effect`的时候注意一下创建`effect`时会给`effect`设置一个`id`而这个`id`是递增的；
组件的创建是从父到子的顺序，那么对应的渲染函数的`id`也是递增的，我们按从小到大的顺序排序就能确保父组件的更新能先于子组件执行。
关于卸载了子组件如何跳过子组件更新，这会涉及到`effect`的知识点，总之在`unmountComponent`时会停止渲染函数副作用，
而被停止的带调度器的副作用函数再次调用不会执行。

##### 3. 执行异步任务  
通过一个索引和每次循环都动态获取任务队列长度，来确保执行过程中动态添加了异步任务也能在此次循环中执行完毕；
关于循环检测我们放在后面讲解，执行完毕后就会进入异步回调任务队列的执行，最后再检测是否需要循环清空队列。  

- #### 2. `postFlushCbs`队列执行  
```typescript
// runtime-core/scheduler.ts
export function flushPostFlushCbs(seen?: CountMap) {
  // 存在任务就执行
  if (postFlushCbs.length) {
    // 拷贝一份去重的任务队列
    pendingPostFlushCbs = [...new Set(postFlushCbs)]
    postFlushCbs.length = 0
    if (__DEV__) {
      seen = seen || new Map()
    }
    // 循环执行
    for (
      pendingPostFlushIndex = 0;
      pendingPostFlushIndex < pendingPostFlushCbs.length;
      pendingPostFlushIndex++
    ) {
      if (__DEV__) {
        checkRecursiveUpdates(seen!, pendingPostFlushCbs[pendingPostFlushIndex])
      }
      pendingPostFlushCbs[pendingPostFlushIndex]()
    }
    // 重置信息
    pendingPostFlushCbs = null
    pendingPostFlushIndex = 0
  }
}
```
`postFlushCbs`队列的执行仅会清空开始任务时队列所拥有的所有回调任务，
在`postFlushCb`中有可能添加异步任务也有可能添加异步任务回调，
我们需要保持异步任务和异步任务回调的执行顺序，所以我们需要拷贝一份当前的异步回调任务，
以免执行异步回调任务队列中动态添加的异步回调任务被提前执行。  

- ## 防止循环任务  
```typescript
// runtime-core/scheduler.ts
// 任务单次微任务执行上限
const RECURSION_LIMIT = 100
function checkRecursiveUpdates(seen: CountMap, fn: Job | Function) {
  if (!seen.has(fn)) {
    seen.set(fn, 1)
  } else {
    const count = seen.get(fn)!
    // 任务在一次微任务中执行次数超过RECURSION_LIMIT视为循环任务，直接抛出错误
    if (count > RECURSION_LIMIT) {
      throw new Error(
        'Maximum recursive updates exceeded. ' +
          "You may have code that is mutating state in your component's " +
          'render function or updated hook or watcher source function.'
      )
    } else {
      // 未达到上限，增加计数
      seen.set(fn, count + 1)
    }
  }
}
```
在整个任务过程中我们保持了`seen`变量来记录每个任务的执行次数，当超过`RECURSION_LIMIT`时就是做循环任务来抛出异常。  

## 总结  
这就是`Vue3`异步任务调度的全部，异步任务调度在不仅使用在组建更新上，也会使用在`watch API`中，
现在我们对于`Vue3`调度的有了更深层次的理解，这非常有助于之后的`effect`、`watch API`的阅读。