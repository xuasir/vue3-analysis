### update流程

## 本篇目标

1. 了解组件的更新流程
2. 了解普通元素的更新流程
3. 深入解析`Vdom Tree`的`diff`算法

## 前置准备

本篇的组件结构依旧采用和上篇相同的组件结构，还需要明确`update`的目标一方面是更新组件相关的状态、数据等等，
另一方面就是得到新的`VNode Tree`通过新旧`VNode Tree`的对比`diff`从而得到最小的`Dom Tree变更`，
在原来的`Dom Tree`上去进行最小变更，而不是全量的先卸载再挂载的过程。

## 解析

1. ## 组件更新

首先我们应该来考虑`update`的入口是什么？在我们书写`Vue`代码时，
非常自然的去使用组件内部的一些`data`、`props`等等数据来和视图显示的内容、交互操作进行一个直接或间接的绑定，
这时候当状态更改是视图也会进行更新；可想而知的是视图更新一定是以组件为单位的，
当我们改变组件内部状态、父组件更新子组件或者`forceUpdate`时，触发的应该是组件的`update`方法。
我们依旧回到`runtime-core/renderer.ts`文件中的`setupRenderEffect`函数：

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
    // create reactive effect for rendering
    // 创建执行带副作用的渲染函数并保存在update属性上
    instance.update = effect(function componentEffect() {
      if (!instance.isMounted) {
        // 挂载组件
      } else {
        // 更新组件
        // 组件自身发起的更新 next 为 null
        // 父组件发起的更新 next 为 下一个状态的组件VNode
        let { next, vnode } = instance
        let originNext = next
        
        if (next) {
          // 如果存在next 我们需要更新组件实例相关信息
          // 修正instance 和 nextVNode相关指向关系
          // 更新Props和Slots
          updateComponentPreRender(instance, next, optimized)
        } else {
          next = vnode
        }
        // 渲染新的子树
        const nextTree = renderComponentRoot(instance)
        const prevTree = instance.subTree
        instance.subTree = nextTree
        next.el = vnode.el
        // diff子树
        patch(
          prevTree,
          nextTree,
          // 排除teleport的情况，即时获取父节点
          hostParentNode(prevTree.el!)!,
          // 排除fragement情况，即时获取下一个节点
          getNextHostNode(prevTree),
          instance,
          parentSuspense,
          isSVG
        )
        next.el = nextTree.el
      }
    }, EffectOptions)
  }
```

纵观整个更新组件的流程，我们需要先对组件进行信息的更新，然后再渲染出新的子树最终在子树的`patch`过程中将所有更改都应用到`Dom`上；
我们先关注在`instance.next`下一个状态的`组件VNode`上，通过我们之前的分析可以得出，`Vue`以组件为单位进行更新时，
能触发组件更新的情况除了组件自身也就只有父组件了；我们按情况分析一下这个`next`的产生情况然后再回到当前这个函数的逻辑。

- #### 无`next`

> 当组件自身发起更新时，我们直接来到就应该是当前的`setupRenderEffect`函数逻辑，此时是没有时机来生成`next`，
这种情况也是比较简单，直接就到了生成子树然后`patch`子树的过程。

- #### 有`next`

> 我们首先考虑这个`next`状态的`组件VNode`从何而来？从触发更新的方式来思考，产生`next`的肯定是来自父组件的更新，
因为父组件更新时是会重新渲染子树的，而我们当前组件作为子组件肯定是包含在这颗子树上的，便创建了新的`子组件VNode`；
我们暂时了解到`next`的产生，具体next如何被赋值、如何开始执行子组件的`update`这些问题我们留在`patch`方法的组件相关子逻辑中解析，暂时带着这个疑问往下解析。

- ### `patch`前组件信息更新
现在我们知道了`next`产生情况，我们直接看到`updateComponentPreRender`函数是怎么更新、都更新了一些什么内容：

```ts
// runtime-core/renderer.ts
const updateComponentPreRender = (
  instance: ComponentInternalInstance,
  nextVNode: VNode,
  optimized: boolean
) => {
  // 下一个状态的组件VNode.component指向实例
  nextVNode.component = instance
  // 缓存旧的props
  const prevProps = instance.vnode.props
  // 修改instance.vnode的指向
  instance.vnode = nextVNode
  // 重新设置next为空
  instance.next = null
  // 更新props
  updateProps(instance, nextVNode.props, prevProps, optimized)
  // 更新插槽
  updateSlots(instance, nextVNode.children)
}
```

更新主要在处理新`VNode`和`instance`关系上以及更新与父组件强相关的属性`props`和`slots`；
这样其实也更好理解父组件触发的子组件更新为何需要一个新的`组件VNode`。

处理完组件的最新信息后，也就可以通过`renderComponentRoot`拿到新的组件子树，这个函数以及在挂载篇章解析了，
主要是通过调用组件`render函数`来渲染得到新子树。我们直接到下一个步骤`patch subTree`。		

- ### `patch`流程
按照当前组件的结构来看，我们`patch`子树的第一步应该是`div标签`，但是我们现在关心的是组件及子组件的更新，
我们暂时跳过普通元素的更新，直接看到`hello 组件的patch`在之前篇章的解析基础上我们知道`组件VNode`走的流程是`processComponent`：

```ts
// runtime-core/renderer.ts
 const processComponent = (...) => {
    if (n1 == null) {
      // 组件挂载
      mountComponent(...)
    } else {
      // 组件更新
      updateComponent(n1, n2, optimized)
    }
  }
```

再找到`updateComponent`：

```ts
// runtime-core/renderer.ts
const updateComponent = (n1: VNode, n2: VNode, optimized: boolean) => {
  const instance = (n2.component = n1.component)!
  // 组件是否需要更新
  if (shouldUpdateComponent(n1, n2, optimized)) {
      instance.next = n2
      // 去除异步队列中的 当前组件更新
      invalidateJob(instance.update)
      // 同步执行组件更新
      instance.update()
  } else {
      // 更新 instance和VNode 关系
      n2.component = n1.component
      n2.el = n1.el
      instance.vnode = n2
  }
}
```

```ts
// runtime-core/omponentRenderUtils.ts
export function shouldUpdateComponent(
  prevVNode: VNode,
  nextVNode: VNode,
  optimized?: boolean
): boolean {
  const { props: prevProps, children: prevChildren } = prevVNode
  const { props: nextProps, children: nextChildren, patchFlag } = nextVNode

  // 包含指令和transition的需要更新
  if (nextVNode.dirs || nextVNode.transition) {
    return true
  }
	// 优化模式
  if (optimized && patchFlag > 0) {
    
    if (patchFlag & PatchFlags.DYNAMIC_SLOTS) {
      // 动态插槽情况
      return true
    }
    if (patchFlag & PatchFlags.FULL_PROPS) {
      // 全量props的情况
      if (!prevProps) {
        // 没有旧props ---> 由新props决定
        return !!nextProps
      }
      // 都存在查询有无变化
      return hasPropsChanged(prevProps, nextProps!)
    } else if (patchFlag & PatchFlags.PROPS) {
      // 模板编译阶段优化 动态props
      const dynamicProps = nextVNode.dynamicProps!
      for (let i = 0; i < dynamicProps.length; i++) {
        const key = dynamicProps[i]
        if (nextProps![key] !== prevProps![key]) {
          return true
        }
      }
    }
  } else {
    // 手写render函数时未优化flags 以下任意场景都需要更新
    if (prevChildren || nextChildren) {
      if (!nextChildren || !(nextChildren as any).$stable) {
        return true
      }
    }
    // props未改变
    if (prevProps === nextProps) {
      return false
    }
    if (!prevProps) {
      // 没有旧props ---> 由新props决定
      return !!nextProps
    }
    if (!nextProps) {
      // 存在旧props ---> 不存在新props
      return true
    }
    // 新旧props都存在检测否有变化的props 
    return hasPropsChanged(prevProps, nextProps)
  }

  return false
}
```

在`updateComponent`中通过检测组件插槽及`Props`来决定组件是否需要更新，我们直接看到需要更新的情况，
主要是设置组件的`next VNode`并且将异步更新队列中的该组件更新任务清除，防止重复更新，因为当前组件也有可能状态更改触发了更新但是还未执行；
最后一步就是执行组件更新函数，这样就回到了我们一开始的函数逻辑中。这就是整个组件完整的更新流程，包含了父子组件的情况是如何进行递归更新的。
::: tip 组件的递归更新
组件的更新可以来自自身状态的变更，也可以来自父组件的触发；嵌套的父子孙组件更新的触发发生在父组件的新旧子树`patch`过程中，
`Vue`默认会对组件进行`shouldUpdateComponent`优化避免不必要的更新；而来自父组件触发的更新，往往会产生一个`next`状态的组件`VNode`.
:::

2. ## 普通元素更新

看完组件更新后，我们知道，组件只是某一段具体Dom的抽象，到最终进行`diff`的还是普通元素，
现在我们就直接关注到普通元素的更新，在`patch`函数中找到`processElement`然后进入`patchElement`函数中：

```ts
// runtime-core/renderer.ts 
const patchElement = (
    n1: VNode,
    n2: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
  	// 基本信息
    const el = (n2.el = n1.el!)
    const oldProps = n1.props || EMPTY_OBJ
    const newProps = n2.props || EMPTY_OBJ
    // 更新props
    patchProps(...)
    // 更新children
    const areChildrenSVG = isSVG && n2.type !== 'foreignObject'
    patchChildren(..)
  }
```

我将`hooks`函数相关的代码以及针对`patchFlags`的优化操作直接忽略，但是不影响`patchElement`的整体功能：

> 1. 更新props
> 2. 更新children

- ### 更新`props`
我们首先看到`patchProps`这里其实调用的是`web`平台的`patchProps`方法，
位于 `runtime-dom/patchProp.ts`主要是针对`class`和`style`以及指令事件等内容，感兴趣的可以详细阅读。
当`props`更新完成后对于一个原生的Dom元素来说就只剩下`children`需要做更新了，我们直接看到`patchChildren`：

```ts
// runtime-core/renderer.ts
const patchChildren: PatchChildrenFn = (
  n1,
  n2,
  container,
  anchor,
  parentComponent,
  parentSuspense,
  isSVG,
  optimized = false
) => {
  // 获取基本信息
  const c1 = n1 && n1.children
  const prevShapeFlag = n1 ? n1.shapeFlag : 0
  const c2 = n2.children
  const { patchFlag, shapeFlag } = n2
  // children 存在 三种可能： 文本节点、数组型、无children
  if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
    // 新children文本类型的子节点
    if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      // 旧children是数组型，直接卸载
      unmountChildren(c1 as VNode[], parentComponent, parentSuspense)
    }
    if (c2 !== c1) {
      // 新旧都是文本，但是文本不相同直接替换
      hostSetElementText(container, c2 as string)
    }
  } else {
    if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      // 旧children是数组
      if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        // 新children是数组
        patchKeyedChildren(
          c1 as VNode[],
          c2 as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      } else {
        // 不存在新children，直接卸载旧children
        unmountChildren(c1 as VNode[], parentComponent, parentSuspense, true)
      }
    } else {
      // 旧children可能是文本或者空
      // 新children可能是数组或者空
      if (prevShapeFlag & ShapeFlags.TEXT_CHILDREN) {
        // 如果旧children是文本，无论新children是哪个可能都需要先清除文本内容
        hostSetElementText(container, '')
      }
      // 此时原dom内容应该为空
      if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        // 如果新children为数组 直接挂载
        mountChildren(
          c2 as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      }
    }
  }
}
```

得益于在`createVNode`的时候会对`children`进行规范化，我们在`diff children`时候可以仅考虑`children`为数组、文本和空这三种情况，进而进行逻辑判断。
在整体逻辑中我直接忽略了`fragment`的处理，直接看到重点`children`逻辑，我们通过一个流程图来梳理一下思路：

![patchChildren](/vue3-analysis/vue3-patch-children.jpg)

结合代码来看，思路还是比较清晰的，其中`if`条件的设置也很巧妙即包含所有情况，又能清晰的拆分出挂载、删除、对比三个操作，
我们直接看到核心的部分`patchKeyedChildren`因为其他情况还是比较简单的不是清除就是挂载没有产生比对，
我们关心的核心的`diff 算法`也在`patchKeyedChildren`中，所以我们直接看到`patchKeyedChildren`函数内部：  

- ### `children diff`算法  
::: details 点击查看 patchKeyedChildren 代码注释
```ts
// runtime-core/renderer.ts
  const patchKeyedChildren = (...) => {
    // 索引 i
    let i = 0
    // 新children长度
    const l2 = c2.length
    // 旧children结束索引
    let e1 = c1.length - 1 
    // 新children结束索引
    let e2 = l2 - 1
		// 1.同步开始索引
    while (i <= e1 && i <= e2) {
      const n1 = c1[i]
      const n2 = (c2[i] = normalizeVNode(c2[i]))
      // 相同节点
      if (isSameVNodeType(n1, n2)) {
        // 直接patch
        patch(
          n1,
          n2,
          container,
          null,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      } else {
        // 不同跳出
        break
      }
      i++
    }

   	// 2.同步尾部
    while (i <= e1 && i <= e2) {
      const n1 = c1[e1]
      const n2 = (c2[e2] = normalizeVNode(c2[e2]))
      if (isSameVNodeType(n1, n2)) {
        patch(
          n1,
          n2,
          container,
          null,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      } else {
        break
      }
      e1--
      e2--
    }

    // 3. 同步后 需要mount的情况
    if (i > e1) {
      // 旧children 同步完毕
      if (i <= e2) {
        // 如果新children还有剩下，说明新增了需要挂载
        const nextPos = e2 + 1
        // 获取插入的相对位置
        const anchor = nextPos < l2 ? (c2[nextPos] as VNode).el : parentAnchor
        while (i <= e2) {
          // 循环mount
          patch(
            null,
            (c2[i] = normalizeVNode(c2[i])),
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG
          )
          i++
        }
      }
    }

    // 4. 同步后 需要卸载
    else if (i > e2) {
      // 新children已经同步完成
      while (i <= e1) {
        // 如果旧children还剩，说明需要卸载
        unmount(c1[i], parentComponent, parentSuspense, true)
        i++
      }
    }

    // 5. 同步后两者都还剩余，需要更细致判断
    else {
      // 新旧开始索引
      const s1 = i 
      const s2 = i

      // 5.1 建立key--->index的哈希表（新children中的对应关系）
      const keyToNewIndexMap: Map<string | number, number> = new Map()
      for (i = s2; i <= e2; i++) {
        const nextChild = (c2[i] = normalizeVNode(c2[i]))
          keyToNewIndexMap.set(nextChild.key, i)
        }
      }

      // 5.2 建立新children剩余子序列对应在旧children中的索引
      let j
      // 已经patch的个数
      let patched = 0
      // 待patch的个数
      const toBePatched = e2 - s2 + 1
      // 是否需要移动
      let moved = false
      // 
      let maxNewIndexSoFar = 0
      // 新children每个VNode对应索引在旧children中索引的映射表
      const newIndexToOldIndexMap = new Array(toBePatched)
      // 附上初始值为 0
      for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0
			// 开始遍历旧children同步剩下的序列
      for (i = s1; i <= e1; i++) {
        const prevChild = c1[i]
        if (patched >= toBePatched) {
          // 如果已经patch个数大于待patch
          // 说明是需要卸载的元素
          unmount(prevChild, parentComponent, parentSuspense, true)
          continue
        }
        let newIndex
        // 获取当前旧child在新children中的索引
        newIndex = keyToNewIndexMap.get(prevChild.key)
        if (newIndex === undefined) {
          // 如果索引不存在，找不到 直接卸载
          unmount(prevChild, parentComponent, parentSuspense, true)
        } else {
          // 存储当前child在新children索引 ---> 在旧children索引
          newIndexToOldIndexMap[newIndex - s2] = i + 1
          if (newIndex >= maxNewIndexSoFar) {
            // child在新children中的索引为递增就直接更新
            maxNewIndexSoFar = newIndex
          } else {
            // newIndex如果不是递增，说明新children剩余序列相对旧children不是相同的顺序，需要移动某些元素
            moved = true
          }
          // 同时存在于新旧children中的直接patch
          patch(
            prevChild,
            c2[newIndex] as VNode,
            container,
            null,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
          )
          patched++
        }
      }

      // 5.3 移动和挂载
      // 得到newIndexToOldIndexMap的最长上升子序列对应的索引下标
    	// 也就意味着得到了旧children 最长的不需要移动的子序列
      const increasingNewIndexSequence = moved
        ? getSequence(newIndexToOldIndexMap)
        : EMPTY_ARR
      j = increasingNewIndexSequence.length - 1
      // 反向循环
      for (i = toBePatched - 1; i >= 0; i--) {
        const nextIndex = s2 + i
        const nextChild = c2[nextIndex] as VNode
        // 通过新children获取插入的相对位置（dom的后一个元素）
        const anchor =
          nextIndex + 1 < l2 ? (c2[nextIndex + 1] as VNode).el : parentAnchor
        if (newIndexToOldIndexMap[i] === 0) {
          // 没有建立新child在旧children中的索引说明是新增元素需要挂载
          patch(
            null,
            nextChild,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG
          )
        } else if (moved) {
          // 如果需要移动的情况
          // 不需要移动的元素已经没有了那就只剩下需要移动的
          // 当前索引不在最长递增子序列中
          if (j < 0 || i !== increasingNewIndexSequence[j]) {
            // 移动
            move(nextChild, container, anchor, MoveType.REORDER)
          } else {
            j--
          }
        }
      }
    }
  }
```
::: 

::: tip 核心流程
针对新旧两个`children`数组进行如下操作：  
1. 同步开始索引
2. 同步尾部索引
3. 同步后 需要mount的情况
4. 同步后 需要卸载
5. 同步后两者都还剩余，需要更细致判断
:::


`patchKeyedChildren`函数整体逻辑比较复杂，我们需要通过不同的样例来分析，源码中也贴心的将程序拆分成了几个小块并标识了，
我们依据每个部分的功能来剖析每部分逻辑，当然我们还是应该明确`patchKeyedChildren`函数的目的是比对`children`找出最小的变更然后在`Dom`上进行变更修改：

#### 1. 同步头部和尾部
对于两个新旧`children`来说我们将其简化成两个数组里面存储的是简单类型，这样能方便我们理解程序运行，并且不影响对于原本逻辑的理解。

![diff-1](/vue3-analysis/vue3-diff-1.jpg)

如果我们有上图的两组`children`，而同步头部的意思是从左端一直往右端依次比对两个`children`中的元素，
直到遇到不相同的就停止，同步尾部就是反向的过程；对首尾部进行同步后会出现三种情形，如下图所示：

![diff-1](/vue3-analysis/vue3-diff-2.jpg)

我们再具体看看源代码中是如何设置变量以及开展逻辑的：

```ts
 // 索引 i
let i = 0
// 新children长度
const l2 = c2.length
// 旧children结束索引
let e1 = c1.length - 1 
// 新children结束索引
let e2 = l2 - 1
// 1.同步开始索引
while (i <= e1 && i <= e2) {
  const n1 = c1[i]
  const n2 = (c2[i] = normalizeVNode(c2[i]))
  // 相同节点
  if (isSameVNodeType(n1, n2)) {
    // 直接patch
    patch(
      n1,
      n2,
      container,
      null,
      parentComponent,
      parentSuspense,
      isSVG,
      optimized
    )
  } else {
    // 不同跳出
    break
  }
  i++
}
```

::: tip 注意
在代码中是以开始索引和结束索引为边界，也就意味着 `i e1 e2`三个变量的定义是当前未遍历到的`child`的索引值，
当满足`i<=e1`或者`i<=e2`时， `i e1或者e2`是有效且未处理到的有效索引。
:::

#### 2. 处理同步后不同剩余情况
而在源代码中后续的步骤也正是分别对这三种情况进行了不同的逻辑处理：

1. ##### 新`children`有剩余

   旧`children`都遍历完成了，但是新`children`还有剩余代表本次更新需要新挂载新`children`剩下的子序。

2. ##### 旧`children`有剩余

   新`children`都遍历完成了，但是旧`children`还有剩余代表本次更新需要卸载旧`children`剩下的子序。

   我们暂时看一下源代码是如何处理这两种场景的判断条件的：

   ```ts
   if (i > e1) {
     // 旧children 同步完毕
     if (i <= e2) {
       // 如果新children还有剩下，说明新增了需要挂载
       ...
       while (i <= e2) {
         // 循环mount
         patch(..., c2[i], ...)
         i++
       }
     }
   }
   // 4. 同步后 需要卸载
   else if (i > e2) {
     // 新children已经同步完成
     while (i <= e1) {
       // 如果旧children还剩，说明需要卸载
       unmount(c1[i], parentComponent, parentSuspense, true)
       i++
     }
   }
   ```

   这两种判断条件，都符合我们上面对`i e1 e2`的定义，不存在越界问题；直到这里整体逻辑还是比较简单的。

3. ##### 未知子序列
   在源码中这种新旧`children`两者都剩余的情况被称作未知子序列，尤大的处理方式很巧妙，为了方便讲解，
   在后续对于新`children`剩下的未知子序列简称新子序，旧`children`简称旧子序；
   尤大的整体思路是通过某种方法来查找出新子序相对旧子序最长的顺序未更改的一个子序列，
   然后移动顺序有更改的`child`来达到`diff`的目的；顺序这个概念可能比较难理解，
   因为在一组`children`中它在`Dom`中是有一个兄弟关系的，
   当我们真正的去插入`child`时调用的也是`insertBefore`这样的接口通常需要一个参照元素，
   这样很明显可以得出一组`children`是包含`child`兄弟关系的，更抽象到`children数组`本身，
   `child`的兄弟关系映射到`children`中便可以用数组下标来表示，这是很巧妙的一个点；
   在源代码中有几个比较关键的变量，我通过一张图来表述这些变量对应的转换关系：

   ![vue-diff](/vue3-analysis/vue3-diff-3.jpg)

  ::: tip 建议
  建议结合debugger断点调试和图文来理解这里的最长顺序子序是如何被设计的
  :::

   - ##### 获取最长顺序子序
   最初使用了`keyToNewIndexMap`来保存新子序中元素的所对应的索引下标，
   然后通过遍历旧子序来查找旧子序`child`在新子序中的索引，
   再使用新子序中的索引`newIndex`作为`newIndexToOldIndexMap`的数组下标来存储`child`在旧子序中的索引值（有1的偏差，后文会解释），
   这样就能得到以新子序的顺序递增并且存储对应`child`在旧子序中索引的一个`newIndexToOldIndexMap`索引表；
   这种情况我们只需要从`newIndexToOldIndexMap`中取出一段最长递增子序列就能得到旧子序中出现在新子序的最长的顺序子序，
   然后再对更改顺序的元素进行移动即可完成`diff`。		

   具体到代码中的逻辑注释如下：
   
   ```ts
   // 新旧开始索引
   const s1 = i 
   const s2 = i
   
   // 5.1 建立key--->index的哈希表（新children中的对应关系）
   const keyToNewIndexMap: Map<string | number, number> = new Map()
   for (i = s2; i <= e2; i++) {
     const nextChild = (c2[i] = normalizeVNode(c2[i]))
     keyToNewIndexMap.set(nextChild.key, i)
   }
   }
   
   // 5.2 建立新children剩余子序列对应在旧children中的索引
   let j
   // 已经patch的个数
   let patched = 0
   // 待patch的个数
   const toBePatched = e2 - s2 + 1
   // 是否需要移动
   let moved = false
   // 
   let maxNewIndexSoFar = 0
   // 新children每个VNode对应索引在旧children中索引的映射表
   const newIndexToOldIndexMap = new Array(toBePatched)
   // 附上初始值为 0
   for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0
   // 开始遍历旧children同步剩下的序列
   for (i = s1; i <= e1; i++) {
     const prevChild = c1[i]
     if (patched >= toBePatched) {
       // 如果已经patch个数大于待patch
       // 说明是需要卸载的元素
       unmount(prevChild, parentComponent, parentSuspense, true)
       continue
     }
     let newIndex
     // 获取当前旧child在新children中的索引
     newIndex = keyToNewIndexMap.get(prevChild.key)
     if (newIndex === undefined) {
       // 如果索引不存在，找不到 直接卸载
       unmount(prevChild, parentComponent, parentSuspense, true)
     } else {
       // 存储当前child在新children索引 ---> 在旧children索引
       newIndexToOldIndexMap[newIndex - s2] = i + 1
       if (newIndex >= maxNewIndexSoFar) {
         // child在新children中的索引为递增就直接更新
         maxNewIndexSoFar = newIndex
       } else {
         // newIndex如果不是递增，说明新children剩余序列相对旧children不是相同的顺序，需要移动某些元素
         moved = true
       }
       // 同时存在于新旧children中的直接patch
       patch(
         prevChild,
         c2[newIndex] as VNode,
         container,
         null,
         parentComponent,
         parentSuspense,
         isSVG,
         optimized
       )
       patched++
     }
   }
   ```
   
   在建立`newIndexToOldIndexMap`索引表中我们可以对需要卸载和`patch`的`child`分别进行`unmount`和`patch`，
   剩下的就只需要进行移动或者挂载。移动的情况很好理解就是相对顺序改变了，但是需要挂载的元素是怎么判断出来的呢？  
   我们可以看到对于`newIndexToOldIndexMap`是进行了初始值为`0`的赋值工作的，
   当我们遍历整个旧子序来构建`newIndexToOldIndexMap`时如果在旧子序中的`child`没有包含在新子序中，
   那就意味着`newIndexToOldIndexMap`对应的值存储的还是初始值`0`，因为我们永远不会遍历到也永远不会去存储该`child`对应的旧子序索引；
   这也是为什么`newIndexToOldIndexMap[newIndex - s2] = i + 1`这里对于`i`需要进行`1`的偏移的原因，防止 `i == 0`的情况干扰。		
   
  - ##### 最后看到移动和挂载阶段

   ```ts
   // 5.3 移动和挂载
   // 得到newIndexToOldIndexMap的最长上升子序列对应的索引下标
   // 也就意味着得到了旧children 最长的不需要移动的子序列
   //  这里采用了最长递增子序列的方式来查找出，新子序中最长的保持了旧子序顺序的元素下标（也就是在新子序中的下标）
   const increasingNewIndexSequence = moved
   ? getSequence(newIndexToOldIndexMap)
   : EMPTY_ARR
   j = increasingNewIndexSequence.length - 1
   // 反向循环
   for (i = toBePatched - 1; i >= 0; i--) {
     const nextIndex = s2 + i
     const nextChild = c2[nextIndex] as VNode
     // 通过新children获取插入的相对位置（dom的后一个元素）
     const anchor =
           nextIndex + 1 < l2 ? (c2[nextIndex + 1] as VNode).el : parentAnchor
     if (newIndexToOldIndexMap[i] === 0) {
       // 没有建立新child在旧children中的索引说明是新增元素需要挂载
       patch(
         null,
         nextChild,
         container,
         anchor,
         parentComponent,
         parentSuspense,
         isSVG
       )
     } else if (moved) {
       // 如果需要移动的情况
       // 不需要移动的元素已经没有了那就只剩下需要移动的
       // 当前索引不在最长递增子序列中
       if (j < 0 || i !== increasingNewIndexSequence[j]) {
         // 移动
         move(nextChild, container, anchor, MoveType.REORDER)
       } else {
         j--
       }
     }
   }
   ```
   
   逻辑注释也比较全，需要注意的是这里的遍历是反向的遍历新子序的长度次；为什需要从后面的元素开始遍历呢？  
   这是因为`insertBefore`需要的参照元素是后面的一个`Dom元素`而假如存在一种情况后面的元素是需要`mount`的那前面需要移动的元素就找不到参照元素导致插入失败。		
  
   这就是整个`children diff`的过程，建议采用一些点到顺序的实例，通过`debugger`来走一遍`diff`算法，这样会有更深刻的理解。
   
   ## 流程图
   
   ![update](/vue3-analysis/vue3-update.jpg)
   
   整体流程如上，十分建议通过`debugger`的方式来反复消化这部分逻辑，才能更好的理解尤大代码的精妙之处，
   其中关于最长递增子序的求法并没有详细讲解，这个我在之后会写一篇关于最长递增子序列的专门文章来具体解析最长上升子序列的解法；
   下一篇会是关于`setup`函数这个`Vue3`的新`options`选项。