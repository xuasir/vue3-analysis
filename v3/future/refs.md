### 模板 `Refs`

`ref`一直是`Vue`用来注册元素或者组件引用信息的`attrs`，在`Vue2`中注册的引用信息会存储在`$refs`中，
而在`Vue3`中模板`ref`和状态`ref`已经统一，也就意味着我们直接指定`ref`会优先在`state`上查找同名的`ref`并且注册引用信息。
`Vue3`的模板`Refs`可以像如下使用：

```html
<template>
  <div ref="root"></div>
</template>

<script>
  import { ref, onMounted } from "vue";

  export default {
    setup() {
      const root = ref(null);
      onMounted(() => {
        // 在渲染完成后, 这个 div DOM 会被赋值给 root ref 对象
        console.log(root.value); // <div/>
      });
      return {
        root,
      };
    },
  };
</script>
```

## 本篇目标

1. 理解`refs`的初始化和更新流程

## 解析

模板`Refs`的设置时机在一个`VNode`的`patch`的结束后：

```typescript
// runtime-core/renderer.ts
const patch: PatchFn = (
  n1,
  n2,
  container,
  anchor = null,
  parentComponent = null,
  parentSuspense = null,
  isSVG = false,
  optimized = false
) => {
  const { type, ref, shapeFlag } = n2;
  // patch 阶段
  // set ref
  if (ref != null && parentComponent) {
    setRef(ref, n1 && n1.ref, parentComponent, parentSuspense, n2);
  }
};
```

这也很好理解，因为一个`VNode patch`结束了，就意味着这个`VNode`已经更新或者挂载完成；这也是设置引用的合适时机。
同时在卸载一个`VNode`时我们也需要设置一次引用。

```typescript
// runtime-core/renderer.ts
const unmount: UnmountFn = (
  vnode,
  parentComponent,
  parentSuspense,
  doRemove = false
) => {
  const {
    type,
    props,
    ref,
    children,
    dynamicChildren,
    shapeFlag,
    patchFlag,
    dirs,
  } = vnode;
  // unset ref
  if (ref != null && parentComponent) {
    setRef(ref, null, parentComponent, parentSuspense, null);
  }
  // 卸载操作
  // ...
};
```

可以发现初始化、更新和卸载都是使用了`setRef`来操作的，让我们直接看到`setRef`函数体。

## 函数体

```typescript
export const setRef = (
  rawRef: VNodeNormalizedRef,
  oldRawRef: VNodeNormalizedRef | null,
  parentComponent: ComponentInternalInstance,
  parentSuspense: SuspenseBoundary | null,
  vnode: VNode | null
) => {
  let value: ComponentPublicInstance | RendererNode | null;
  if (!vnode) {
    // 卸载时新值为null
    value = null;
  } else {
    // 更新或者初始化
    if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
      // 是一个带状态的组件
      // 新值为组件的公共代理
      value = vnode.component!.proxy;
    } else {
      // 普通元素
      value = vnode.el;
    }
  }
  // vnode ref 经过标准化后 [当前渲染组件实例，ref绑定元素]
  const [owner, ref] = rawRef;
  // 去除旧ref
  const oldRef = oldRawRef && oldRawRef[1];
  // 拿到当前渲染组件的refs
  const refs = owner.refs === EMPTY_OBJ ? (owner.refs = {}) : owner.refs;
  // 拿到当前渲染组件的setup状态
  const setupState = owner.setupState;

  // 存在oldRef 并且新旧ref不为同一个时清空oldRef
  if (oldRef != null && oldRef !== ref) {
    if (isString(oldRef)) {
      // 清空
      refs[oldRef] = null;
      // setup状态中存在同名ref
      if (hasOwn(setupState, oldRef)) {
        在postCb中设置为空;
        queuePostRenderEffect(() => {
          setupState[oldRef] = null;
        }, parentSuspense);
      }
    } else if (isRef(oldRef)) {
      // 如果ref类型直接设置为null
      oldRef.value = null;
    }
  }
  // 设置新ref
  if (isString(ref)) {
    refs[ref] = value;
    if (hasOwn(setupState, ref)) {
      queuePostRenderEffect(() => {
        setupState[ref] = value;
      }, parentSuspense);
    }
  } else if (isRef(ref)) {
    ref.value = value;
  } else if (isFunction(ref)) {
    // 函数参数 :ref="(el, refs) => {}"
    callWithErrorHandling(ref, parentComponent, ErrorCodes.FUNCTION_REF, [
      value,
      refs,
    ]);
  } else if (__DEV__) {
    warn("Invalid template ref type:", value, `(${typeof value})`);
  }
};
```

`setRef`的逻辑还是非常简单的，主要可以归纳为以下步骤：

> 1. 求新引用信息
> 2. 取出相关信息
> 3. 如果模板`ref`绑定值发生变化，清空旧`ref`
> 4. 设置新的模板`ref`

具体逻辑就不再细讲，我们重点关注模板`Refs`可以接受的三种类型参数分别是`string`、`Ref`和函数。
函数的参数形态使得能够在`v-for`下更加轻松的获取引用：

```html
<template>
  <div v-for="(item, i) in list" :ref="el => { divs[i] = el }">
    {{ item }}
  </div>
</template>

<script>
  import { ref, reactive, onBeforeUpdate } from "vue";

  export default {
    setup() {
      const list = reactive([1, 2, 3]);
      const divs = ref([]);

      // 确保在每次变更之前重置引用
      onBeforeUpdate(() => {
        divs.value = [];
      });

      return {
        list,
        divs,
      };
    },
  };
</script>
```

## 总结

`Vue3`的模板`Refs`与`Ref`类型的概念进行了统一，并且提供了函数的参数类型，能更加灵活的在复杂情况下获取元素和组件的引用信息。
