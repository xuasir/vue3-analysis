### 插槽

插槽系统在`Vue2`中非常重要的逻辑抽象方式，通过插槽来分发内容使得高阶的组件能够能加聚焦在逻辑的处理上，
在`Vue2`的生态中就有`vue-promised`这样的类库充分利用了插槽来处理`promise`包装后的异步请求状态。  
`vue2.6`的更新后作用域插槽和普通插槽由`v-slot`或`#[..]`来统一声明，`Vue3`的语法也基本保持一致：

```html
// comp-a
<div>
  <slot></slot>
  <slot name="named" v-bind:user="use"></slot>
</div>
```

```html
// comp-b
<comp-a>
  <template v-slot:default>
    default
  </template>
  <template #[named]="slotProps">
    {{ slotProps.xxxx }}
  </template>
</comp-a>
```

让我们来看看组件内部是如何处理`slots`的。

## 本篇目标

1. 理解插槽的初始化和更新流程
2. 了解插槽是如何被编译的

## 解析

本篇对于插槽的解析我们会按照一个插槽整个生命周期来解析，从被编译成什么样的渲染函数再到如何被处理到组件`VNode`和`instance`上，
以及插槽的渲染。

::: tip 注意
下文的插槽组件指的是声明插槽的组件  
下文的父组件是指使用插槽组件作为子组件的组件  
下文的插槽渲染函数指的是`render`得到插槽内容的函数
:::

## 插槽如何被编译

- #### 插槽组件如何被编译

```html
<div>
  <slot></slot>
  <slot name="named" v-bind:user="user"></slot>
</div>
```

```typescript
export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (
    openBlock(),
    createBlock("div", null, [
      renderSlot(_ctx.$slots, "default"),
      renderSlot(_ctx.$slots, "named", { user: _ctx.user }),
    ])
  );
}
```

我们看到编译的结果中，当我们执行该组件的`render`函数会调用一个`renderSlot`的方法来渲染插槽，我们找到这个方法：

```typescript
// runtime-core/helpers/renderSlot.ts
export function renderSlot(
  slots: Slots,
  name: string,
  props: Data = {},
  fallback?: () => VNodeArrayChildren
): VNode {
  // 取出相应的插槽渲染函数
  let slot = slots[name];
  return (
    openBlock(),
    // 创建一个fragment
    createBlock(
      Fragment,
      { key: props.key },
      // 执行slot渲染函数获取子元素
      slot ? slot(props) : fallback ? fallback() : [],
      // 确定fragment的patchFlag
      (slots as RawSlots)._ === SlotFlags.STABLE
        ? PatchFlags.STABLE_FRAGMENT
        : PatchFlags.BAIL
    )
  );
}
```

`renderSlot`会从组件实例上保存的`slots`中取出相应的插槽渲染函数，然后调用执行得到子节点，`SlotFlags`的作用会在下文中提到；
那么实例上的`slots`渲染函数从何而来？

- #### 父组件如何被编译

```html
<com-a>
  <template #default>
    <span>default</span>
  </template>
  <template #named="slotProps">
    <span>{{ slotProps.user }}</span>
  </template>
</com-a>
```

```typescript
export function render(_ctx, _cache, $props, $setup, $data, $options) {
  const _component_com_a = _resolveComponent("com-a");

  return (
    _openBlock(),
    _createBlock(_component_com_a, null, {
      default: withCtx(() => [createVNode("span", null, "default")]),
      named: withCtx((slotProps) => [
        createVNode(
          "span",
          null,
          _toDisplayString(slotProps.user),
          1 /* TEXT */
        ),
      ]),
      _: 1,
    })
  );
}
```

在使用带插槽组件的时候，会将插槽编译成组件的`children`参数，并且每个插槽的渲染函数会使用`withCtx`这个函数来包裹，
我们看一看这个`withCtx`做了哪些处理。

```typescript
// runtime-core/helpers/withRenderContext.ts
export function withCtx(
  fn: Slot,
  ctx: ComponentInternalInstance | null = currentRenderingInstance
) {
  // 父组件渲染函数执行
  if (!ctx) return fn;
  return function renderFnWithContext() {
    // 插槽组件渲染插槽
    const owner = currentRenderingInstance;
    setCurrentRenderingInstance(ctx);
    const res = fn.apply(null, arguments as any);
    setCurrentRenderingInstance(owner);
    return res;
  };
}
```

我们先明确的就是在当父组件中渲染函数的执行会调用`withCtx`从而返回一个`renderFnWithContext`；
而我们刚刚所探讨的`renderSlot`是在插槽组件的渲染函数执行时执行的，
其实`renderSlot`调用时取出的插槽渲染函数就是`renderFnWithContext。

- #### 为什么这样处理？

  我们先理清楚`withCtx`所做的事情是通过闭包来插槽渲染函数和`currentRenderingInstance`上下文，
  当`withCtx`执行时`currentRenderingInstance`指向的是父组件的实例，
  而执行`renderFnWithContext`时`currentRenderingInstance`指向的是插槽组件的实例，
  这样我们就能同时持有两个渲染上下文，插槽组件的渲染也能和父组件分离，我们仅需要在执行插槽渲染函数时将渲染上下文设置为父组件，
  执行完毕后重新设置成插槽组件的实例，这样就能正确的进行依赖收集同时也能降低插槽渲染函数和父组件渲染的耦合。

- #### 作用域插槽处理

  作用域插槽的`props`是属于插槽组件的状态，我们在`renderSlot`执行的时候，
  通过`renderFnWithContext`的`arguments`传入插槽渲染函数。

在插槽编译的处理中，`Vue3`将插槽彻底编译成函数同时再次利用闭包特性，使得插槽渲染函数能与父组件渲染分离；
这一点带来了一个优化就是在父组件的更新中可以确定是否能跳过插槽组件的插槽函数更新，而`Vue3`也为插槽设立了三种`slotFlag`如下：

```typescript
export const enum SlotFlags {
  /**
   * 父组件更新 插槽组件不必强制更新
   */
  STABLE = 1,
  /**
   * 父组件更新时 插槽组件需要强制更新 v-for v-if 动态插槽 依赖父组件的状态
   * 会更改插槽位
   */
  DYNAMIC = 2,
  /**
   * 插槽透传 插槽组件的插槽来自父组件转发外部插槽
   */
  FORWARDED = 3,
}
```

- #### `STABLE`

  稳定的插槽意味着父组件使用插槽组件的插槽位在首次渲染完成后就不会再更改，
  每次更新中得益于我们的插槽渲染函数持有父组件的渲染实例，完全可以脱离父组件的更新而自己更新，
  这时候父组件更新并不需要强制执行插槽组件更新，插槽组件只需要执行通过响应式触发的更新来更新，
  因为在执行插槽渲染函数时，渲染实例已经被修正为父组件的渲染实例，这样就能进行正确的依赖收集。

- #### `DYNAMIC`

  动态的插槽意味着父组件使用的插槽组件的插槽位是变化的，可能在某次更新中就会渲染`default`变成渲染`named`，
  这时候我们就需要强制更新子组件以得到正确的插槽渲染。

- #### `FORWARDED`

  `FORWARDED`的情况是存在父子孙三代组件是，子组件仅仅作为透传的功能将父组件传递进来的插槽透传给孙代组件，
  这时候孙代组件插槽的`Flags`需要依赖于父组件的`Flags`而定，我们在后面的标准化插槽时会具体分析到。

其实我们可以总结出，插槽的更新主要有两种情况，一是来自响应式数据的更新这种情况可以不依赖于父组件；
二是插槽位结构的变化带来的更新这时候需要依赖于父组件的强制更新。

我们深度探讨了插槽的更新状况以及父组件和插槽组件编译成什么样的渲染函数来处理的，
但是我们中间缺失了如何将插槽信息挂载到`ctx.$slots`上的，这期间包含了插槽的标准化、初始化以及更新，我们一次来看一看。

## 插槽数据的标准化

我们知道`render`函数最终会创建出组件`VNode`我们将插槽信息通过`children`传递，
这期间会经历标准化`children`的过程最终将标准化后的插槽信息挂载到`VNode.children`上；
我们找到`runtime-core/vnode.ts`中的`createVNode`:

```typescript
// runtime-core/vnode.ts
function _createVNode(
  type: VNodeTypes | ClassComponent | typeof NULL_DYNAMIC_COMPONENT,
  props: (Data & VNodeProps) | null = null,
  children: unknown = null,
  patchFlag: number = 0,
  dynamicProps: string[] | null = null,
  isBlockNode = false
): VNode {
  // class & style 标准化
  // 编码 vnode type
  // 创建 vnode
  // 校验 key
  // 标准化children
  normalizeChildren(vnode, children);
  // block 相关处理
  return vnode;
}
```

我们重点关注在`normalizeChildren`中的处理插槽相关的逻辑：

```typescript
// runtime-core/vnode.ts
export function normalizeChildren(vnode: VNode, children: unknown) {
  let type = 0;
  const { shapeFlag } = vnode;
  if (children == null) {
    // 无childre
  } else if (isArray(children)) {
    // 数组型的children
    type = ShapeFlags.ARRAY_CHILDREN;
  } else if (typeof children === "object") {
    if (
      (shapeFlag & ShapeFlags.ELEMENT || shapeFlag & ShapeFlags.TELEPORT) &&
      (children as any).default
    ) {
      // teleport 的情况
    } else {
      // 插槽
      type = ShapeFlags.SLOTS_CHILDREN;
      // 去除插槽类型
      const slotFlag = (children as RawSlots)._;
      if (!slotFlag && !(InternalObjectKey in children!)) {
        // 未标准化的插槽 需要附加上ctx
        (children as RawSlots)._ctx = currentRenderingInstance;
      } else if (slotFlag === SlotFlags.FORWARDED && currentRenderingInstance) {
        // 透传插槽的情况  需要取决于父组件插槽的`SlotFlags`
        if (
          currentRenderingInstance.vnode.patchFlag & PatchFlags.DYNAMIC_SLOTS
        ) {
          (children as RawSlots)._ = SlotFlags.DYNAMIC;
          vnode.patchFlag |= PatchFlags.DYNAMIC_SLOTS;
        } else {
          (children as RawSlots)._ = SlotFlags.STABLE;
        }
      }
    }
  } else if (isFunction(children)) {
    // 函数children 转成插槽对象
    children = { default: children, _ctx: currentRenderingInstance };
    type = ShapeFlags.SLOTS_CHILDREN;
  } else {
    children = String(children);
    // 强制最为字符children处理
  }
  // 保存children
  vnode.children = children as VNodeNormalizedChildren;
  // 添加新的patchFlag标记
  vnode.shapeFlag |= type;
}
```

我们看到插槽信息的标准化，主要是针对不同的插槽情况来确定`SlotFlags`和附加`shapeFlag`，
这些`Flags`标识会在`patch`过程中发挥作用；并且会对于非编译以及非标准化的插槽进行`ctx`的补全，
以及将函数类型的`children`（手写`render`时可能会传入函数类型`children`作为插槽）标准化成`default`插槽。

## 初始化插槽

初始化插槽的时机发生在组件实例化后调用`setup`之前:

::: details 查看详细代码

```typescript
// runtime-core/component.ts
export function setupComponent(
  instance: ComponentInternalInstance,
  isSSR = false
) {
  isInSSRComponentSetup = isSSR;

  const { props, children, shapeFlag } = instance.vnode;
  const isStateful = shapeFlag & ShapeFlags.STATEFUL_COMPONENT;
  initProps(instance, props, isStateful, isSSR);
  initSlots(instance, children);
  // 执行setup
  const setupResult = isStateful
    ? setupStatefulComponent(instance, isSSR)
    : undefined;
  isInSSRComponentSetup = false;
  return setupResult;
}
```

:::

```typescript
//runtime-core/componentSlots.ts
export const initSlots = (
  instance: ComponentInternalInstance,
  children: VNodeNormalizedChildren
) => {
  if (instance.vnode.shapeFlag & ShapeFlags.SLOTS_CHILDREN) {
    const type = (children as RawSlots)._;
    if (type) {
      // 直接将slots 赋值为 children
      instance.slots = children as InternalSlots;
      // 内部标记不可枚举 通过def设置为不可枚举
      def(children as InternalSlots, "_", type);
    } else {
      normalizeObjectSlots(children as RawSlots, (instance.slots = {}));
    }
  } else {
    instance.slots = {};
    if (children) {
      normalizeVNodeSlots(instance, children);
    }
  }
  def(instance.slots, InternalObjectKey, 1);
};
```

我们按逻辑分支来查看，如果组件未被打上`SLOTS_CHILDREN`的`shapeFlag`直接进入`normalizeVNodeSlots`来处理；

```typescript
//runtime-core/componentSlots.ts
const normalizeVNodeSlots = (
  instance: ComponentInternalInstance,
  children: VNodeNormalizedChildren
) => {
  if (__DEV__ && !isKeepAlive(instance.vnode)) {
    warn(
      `Non-function value encountered for default slot. ` +
        `Prefer function slots for better performance.`
    );
  }
  const normalized = normalizeSlotValue(children);
  instance.slots.default = () => normalized;
};
const normalizeSlotValue = (value: unknown): VNode[] =>
  isArray(value)
    ? value.map(normalizeVNode)
    : [normalizeVNode(value as VNodeChild)];
```

`normalizeVNodeSlots`会将`children`标准化成一个返回`Array children`的函数并且赋值给`default`插槽位。

如果组件被打上`SLOTS_CHILDREN`的`shapeFlag`，则通过插槽的类型来判断，已经打上`slotFlag`的插槽信息说明是编译而来或者是标准化过的，
直接赋值给`slots`即可；如果是未被打上`slotFlag`的则进入`normalizeObjectSlots`来标准化。

```typescript
//runtime-core/componentSlots.ts
const normalizeObjectSlots = (rawSlots: RawSlots, slots: InternalSlots) => {
  const ctx = rawSlots._ctx;
  for (const key in rawSlots) {
    // 内部 key 跳过
    if (isInternalKey(key)) continue;
    const value = rawSlots[key];
    if (isFunction(value)) {
      // 使用withCtx来保存ctx
      slots[key] = normalizeSlot(key, value, ctx);
    } else if (value != null) {
      if (__DEV__) {
        warn(
          `Non-function value encountered for slot "${key}". ` +
            `Prefer function slots for better performance.`
        );
      }
      // 非函数插槽 转化成函数插槽
      const normalized = normalizeSlotValue(value);
      slots[key] = () => normalized;
    }
  }
};
const normalizeSlot = (
  key: string,
  rawSlot: Function,
  ctx: ComponentInternalInstance | null | undefined
): Slot =>
  withCtx((props: any) => {
    if (__DEV__ && currentInstance) {
      warn(
        `Slot "${key}" invoked outside of the render function: ` +
          `this will not track dependencies used in the slot. ` +
          `Invoke the slot function inside the render function instead.`
      );
    }
    // 标准化插槽返回值 --> 数组型的children
    return normalizeSlotValue(rawSlot(props));
  }, ctx);
```

整个标准化插槽数据的过程需要保证最终插槽是函数类型的，已提供更好的性能。

## 更新插槽

插槽的更新发生在组件重新渲染之前：

::: details 查看详细代码

```typescript
// runtime-core/renderer.ts
const updateComponentPreRender = (
  instance: ComponentInternalInstance,
  nextVNode: VNode,
  optimized: boolean
) => {
  nextVNode.component = instance;
  const prevProps = instance.vnode.props;
  instance.vnode = nextVNode;
  instance.next = null;
  // 更新props
  updateProps(instance, nextVNode.props, prevProps, optimized);
  // 更新插槽
  updateSlots(instance, nextVNode.children);
};
```

:::

```typescript
//runtime-core/componentSlots.ts
export const updateSlots = (
  instance: ComponentInternalInstance,
  children: VNodeNormalizedChildren
) => {
  const { vnode, slots } = instance;
  let needDeletionCheck = true;
  let deletionComparisonTarget = EMPTY_OBJ;
  if (vnode.shapeFlag & ShapeFlags.SLOTS_CHILDREN) {
    const type = (children as RawSlots)._;
    if (type) {
      // 编译的插槽
      if (__DEV__ && isHmrUpdating) {
        extend(slots, children as Slots);
      } else if (type === SlotFlags.STABLE) {
        // 稳定的插槽不需要更新
        needDeletionCheck = false;
      } else {
        // 动态的插槽 编译而来 可以跳过规范化 但是不能跳过合并
        extend(slots, children as Slots);
      }
    } else {
      // 稳定的插槽不会进行更改，不需要删除
      needDeletionCheck = !(children as RawSlots).$stable;
      // 规范化插槽
      normalizeObjectSlots(children as RawSlots, slots);
    }
    // 保存新的插槽信息
    deletionComparisonTarget = children as RawSlots;
  } else if (children) {
    // 没有插槽对象作为children 而是直接注入children到组件中
    // 将其规范化成default插槽位
    normalizeVNodeSlots(instance, children);
    // 除了default 其他的插槽位全部删除
    deletionComparisonTarget = { default: 1 };
  }

  // 删除变更的插槽
  if (needDeletionCheck) {
    for (const key in slots) {
      // 不在新的插槽中直接删除
      if (!isInternalKey(key) && !(key in deletionComparisonTarget)) {
        delete slots[key];
      }
    }
  }
};
```

插槽的更新依旧是和初始化相似的判断，以编译而来的`slotFlag`为优化信息，稳定的插槽能跳过插槽渲染函数的更新；
其余情况则进行动态的添加和删除，以获取最新的标准化插槽对象。

## 整体流程

![slot](/vue3-analysis/future/slot.jpg)

## 总结

这就是插槽的整个生命周期，以及它是如何与父组件分离渲染的；`slotFlag`也涉及到`shouldUpdateComponent`的优化如下：

```typescript
// runtime-core/componentRenderUtils.ts
export function shouldUpdateComponent(
  prevVNode: VNode,
  nextVNode: VNode,
  optimized?: boolean
): boolean {
  const { props: prevProps, children: prevChildren } = prevVNode;
  const { props: nextProps, children: nextChildren, patchFlag } = nextVNode;
  // 其他判断优化
  if (patchFlag & PatchFlags.DYNAMIC_SLOTS) {
    return true;
  }
  // 其他判断优化
  return false;
}
```

这其实就是类似`React`的`shouldUpdateComponent`和`useMemo`优化，只不过`Vue3`会在内部帮我们做好这一步优化。
