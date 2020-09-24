### `Teleport`
在开发场景中经常会出现需要动态创建`Dom`元素并且挂载到`Dom`中当前组件树不可到达的节点位置类似：动态创建弹出框、通知块等等需求；
在`Vue2.x`中我们经常采用`Vue.extend`来创建组件构造函数并且在手动实例化后挂载到`Dom`中所需要的位置上，这样的方式学习成本较高
并且需要注意到很多细节类似单例的问题等等，而`Vue3`为我们带来了更加简介的`Teleport`组件来实现这一功能，我们直接通过一个实例来看看使用方式： 

```html
<Teleport :to="'app'">
  <span>teleported</span>
</Teleport>
```

使用`Teleport`的情况我们仅需要一个`to`的属性来指定需要挂载到的地方，就可以完成上述的复杂功能，是不是非常简洁。
同时`Teleport`也支持另外一个`disabled`的属性，来决定`Teleport`的内容是否要被传送到指定节点处，
如果`disabled === true` `Teleport`会将内容渲染在原组件树中节点存在的位置。

了解了`Teleport`的使用方法和特性后，让我们来看看它的实现方式吧。

## 本篇目标

1. 理解`Teleport`的运作机制

## 解析

和`Suspense`类似，`Teleport`也是仅仅看起来像一个组件，对外部的使用者来说是会作为组件来处理，对于内部的处理却被当做一个接口，
我们直接从`patch`阶段对于`Teleport`处理看起。

## `Teleport`的挂载

```typescript
// runtime-core/renderer.ts
//...
if (shapeFlag & ShapeFlags.TELEPORT) {
  ;(type as typeof TeleportImpl).process(
    n1 as TeleportVNode,
    n2 as TeleportVNode,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    optimized,
    internals
  )
}
// ...
```

和`Suspense`保持一致，对于`Teleport`的`patch`也是交由`TeleportImpl.process`来进行处理的，我们继续看到`process`函数体：

```typescript
// runtime-core/components/Teleport.ts
process(
  n1: TeleportVNode | null,
  n2: TeleportVNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized: boolean,
  internals: RendererInternals
) {
  // 获取宿主平台操作API
  const {
    mc: mountChildren,
    pc: patchChildren,
    pbc: patchBlockChildren,
    o: { insert, querySelector, createText, createComment }
  } = internals
  // 获取disabled 状态
  const disabled = isTeleportDisabled(n2.props)
  const { shapeFlag, children } = n2
  if (n1 == null) {
    // 挂载阶段
    // 创建 注释节点
    const placeholder = (n2.el = __DEV__
      ? createComment('teleport start')
      : createText(''))
    const mainAnchor = (n2.anchor = __DEV__
      ? createComment('teleport end')
      : createText(''))
    // 先container中插入注释节点
    insert(placeholder, container, anchor)
    insert(mainAnchor, container, anchor)

    // 获取将要 传送到的dom节点
    const target = (n2.target = resolveTarget(n2.props, querySelector))
    // 在target中append一个空的文本节点当做 teleport最终insert的相对节点
    const targetAnchor = (n2.targetAnchor = createText(''))
    if (target) {
      // 首先插入 锚点 节点
      insert(targetAnchor, target)
    } else if (__DEV__) {
      warn('Invalid Teleport target on mount:', target, `(${typeof target})`)
    }
    // 动态挂载到正确的位置和锚点
    const mount = (container: RendererElement, anchor: RendererNode) => {
      // Teleport 无论是标准化还是编译而来都只会包含 数组型的children
      if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        mountChildren(
          children as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      }
    }

    if (disabled) {
      // 禁用状态 挂载到组件所在dom树节点位置
      mount(container, mainAnchor)
    } else if (target) {
      // 挂载到 目标节点下
      mount(target, targetAnchor)
    }
  } else {
    // 更新
  }
  }
```

在挂载过程中出现了两种概念`container`和`targte`我们需要先理解这两个概念：

::: tip 
- `container`

  `Teleport`组件在`Dom Tree`中原本存在的位置的父节点

- `targte`

  `Teleport`目标挂载的节点
:::

有了这两个节点的认识整个挂载流程就非常简单了：

#### 1. 向`container`容器中插入注释节点标识`Teleport`原有位置

#### 2. 解析`Target`并且安插锚点

  解析`target`的过程我们可以详细看看

  ```typescript
    // runtime-core/components/Teleport.ts
    const resolveTarget = <T = RendererElement>(
      props: TeleportProps | null,
      select: RendererOptions['querySelector']
    ): T | null => {
      const targetSelector = props && props.to
      if (isString(targetSelector)) {
        // 字符串类型to 需要select选择器
        if (!select) {
          __DEV__ &&
            warn(
              `Current renderer does not support string target for Teleports. ` +
                `(missing querySelector renderer option)`
            )
          return null
        } else {
          // 获取 targte
          const target = select(targetSelector)
          if (!target) {
            __DEV__ &&
              warn(
                `Failed to locate Teleport target with selector "${targetSelector}". ` +
                  `Note the target element must exist before the component is mounted - ` +
                  `i.e. the target cannot be rendered by the component itself, and ` +
                  `ideally should be outside of the entire Vue component tree.`
              )
          }
          return target as any
        }
      } else {
        // to 为 dom元素
        if (__DEV__ && !targetSelector) {
          warn(`Invalid Teleport target: ${targetSelector}`)
        }
        return targetSelector as any
      }
    }
  ```

  可以看到`props.to`支持传递两种类型的`querySelector`支持的选择器类型以及`Dom`节点（`web`平台）；
  当我们拿到`target`后会向其追加一个空文本节点，作为之后`patchChildren`的锚点。

#### 3. 挂载

  挂载过程主要依据`disabled`的状态来决定挂载到何处，`mount`函数接受挂载位置的父容器以及锚点节点，
  来进行`mountChildren`将`Teleport`的内容挂载到正确的位置。

这就是整个挂载的流程还是非常简单的，我们学习到了`props.to`的可接受类型，以及`disabled`的行为特性。

## `Teleport`的更新

```typescript
// runtime-core/components/Teleport.ts
// update content
n2.el = n1.el
const mainAnchor = (n2.anchor = n1.anchor)!
const target = (n2.target = n1.target)!
const targetAnchor = (n2.targetAnchor = n1.targetAnchor)!
const wasDisabled = isTeleportDisabled(n1.props)
const currentContainer = wasDisabled ? container : target
const currentAnchor = wasDisabled ? mainAnchor : targetAnchor

if (n2.dynamicChildren) {
  // 基于 block 的patch
  patchBlockChildren(
    n1.dynamicChildren!,
    n2.dynamicChildren,
    currentContainer,
    parentComponent,
    parentSuspense,
    isSVG
  )
} else if (!optimized) {
  patchChildren(
    n1,
    n2,
    currentContainer,
    currentAnchor,
    parentComponent,
    parentSuspense,
    isSVG
  )
}

if (disabled) {
  if (!wasDisabled) {
    // enabled -> disabled
    // 移动到 container 容器
    moveTeleport(
      n2,
      container,
      mainAnchor,
      internals,
      TeleportMoveTypes.TOGGLE
    )
  }
} else {
  // target 改变了
  if ((n2.props && n2.props.to) !== (n1.props && n1.props.to)) {
    const nextTarget = (n2.target = resolveTarget(
      n2.props,
      querySelector
    ))
    if (nextTarget) {
      moveTeleport(
        n2,
        nextTarget,
        null,
        internals,
        TeleportMoveTypes.TARGET_CHANGE
      )
    } else if (__DEV__) {
      warn(
        'Invalid Teleport target on update:',
        target,
        `(${typeof target})`
      )
    }
  } else if (wasDisabled) {
    // disabled -> enabled
    // 移动到 target 容器
    moveTeleport(
      n2,
      target,
      targetAnchor,
      internals,
      TeleportMoveTypes.TOGGLE
    )
  }
}
```

更新的过程主要分为两部分：

#### 1. `patchChildren`获取最新的子树

#### 2. 处理`disabled`状态

  对`disabled`的处理核心就在感知出前后状态的转变，主要有四种情况：

  - `disabled -> enabled`  
  - `enabled -> disabled`  
  - `disabled -> disabled`  
  - `enabled -> enabled`  

  能看到源码中采用了一个双重判断来处理，当前状态下为`disabled`的时候仅需要处理原状态为`enabled`的情况将`Teleport`移到`container`容器下。

  当前状态为`enabled`的情况，首先比对的就是`target`是否发生了改变，如果`target`发生了变更就将`Teleport`移动到新的`target`之中；另一种情况就是`disabled -> enabled`将`Teleport`移动到`target`即可。

`Teleport`的更新流程基本就是如此，我们需要掌握的就是`disabled`状态的不同`Teleport`内容会挂载到不同容器之下。

## 总结

这是`Vue3`为我们带来的`Teleport`特性，用非常简洁的接口实现了之前复杂的功能，核心的`props`只有`to`和`disabled`；
与组件的挂载更新基本上是一致的，只是在挂载点的处理上做了扩展；可以看出复杂的功能如果从内部来实现是很有机会简化使用方式的。