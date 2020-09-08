### 指令系统

指令系统一直是`Vue2`的重要扩展能力，也衍生出很多实用的类库比如`vue-lazyload`就是依赖于指令系统构建的；
指令能提供对于`Dom`元素操作的抽象能力，是高效开发不可获取的一部分；`Vue3`在指令的生命周期函数上做了调整，
生命周期名称和组件生命周期保持一致，变化如下：

## 本篇目标

1. 理解完整的指令注册周期
2. 了解`Vue3`指令系统的变更
3. 了解指令钩子函数的执行时机

## 指令的注册

一般我们会通过`app.directive()`来注册全局的指令，我们看到`directive`的函数体：

```typescript
// runtime-core/apiCreateApp.ts
// 创建app上下文
const context = createAppContext()
directive(name: string, directive?: Directive) {
  // 开发环境 校验指令名称合法性
  if (__DEV__) {
    validateDirectiveName(name)
  }
  // 不传指令，视为获取指令
  if (!directive) {
    return context.directives[name] as any
  }
  if (__DEV__ && context.directives[name]) {
    warn(`Directive "${name}" has already been registered in target app.`)
  }
  // 注册指令
  context.directives[name] = directive
  return app
}
// 内建指令
const isBuiltInDirective = /*#__PURE__*/ makeMap(
  'bind,cloak,else-if,else,for,html,if,model,on,once,pre,show,slot,text'
)
// 校验指令名是否合法
export function validateDirectiveName(name: string) {
  if (isBuiltInDirective(name)) {
    warn('Do not use built-in directive ids as custom directive id: ' + name)
  }
}
```

可以看到如果不传递指令声明会视为获取指令，而指令的传参为`Directive`类型，我们看一下这个类型声明：

```typescript
// runtime-core/directives.ts
// 指令声明时可用hooks
export interface ObjectDirective<T = any, V = any> {
  beforeMount?: DirectiveHook<T, null, V>;
  mounted?: DirectiveHook<T, null, V>;
  beforeUpdate?: DirectiveHook<T, VNode<any, T>, V>;
  updated?: DirectiveHook<T, VNode<any, T>, V>;
  beforeUnmount?: DirectiveHook<T, null, V>;
  unmounted?: DirectiveHook<T, null, V>;
  getSSRProps?: SSRDirectiveHook;
}

export type FunctionDirective<T = any, V = any> = DirectiveHook<T, any, V>;
// 指令注册时可接受的方式
export type Directive<T = any, V = any> =
  | ObjectDirective<T, V>
  | FunctionDirective<T, V>;
```

可接受包含钩子函数的对象也能直接接受一个钩子函数将会在`mounted`和`updated`时执行。

## 标准化指令绑定

注册钩子后，我们还需要在元素上去使用进行绑定传递参数使用修饰符一系列操作，
在从模板转化成`VNode`还需要经历一个标准化指令绑定信息的过程，我们看一看带指令的模板会被编译成什么样的渲染函数：

```html
<div v-custom:args.foo.bar="value"></div>
```

```typescript
export function render(_ctx, _cache, $props, $setup, $data, $options) {
  const _directive_custom = _resolveDirective("custom");

  return _withDirectives(
    (_openBlock(), _createBlock("div", null, null, 512 /* NEED_PATCH */)),
    [
      [
        _directive_custom,
        _ctx.value,
        "args",
        {
          foo: true,
          bar: true,
        },
      ],
    ]
  );
}
```

可以看到一个`VNode`要使用某个`directive`需要使用`withDirectives`函数来包裹，`value`、参数和修饰符被转成第二个参数；
我们直接看看这个`withDirectives`的实现。

```typescript
// runtime-core/directives.ts
export function withDirectives<T extends VNode>(
  vnode: T,
  directives: DirectiveArguments
): T {
  // 渲染实例
  const internalInstance = currentRenderingInstance;
  // 只能在render函数中使用
  if (internalInstance === null) {
    __DEV__ && warn(`withDirectives can only be used inside render functions.`);
    return vnode;
  }
  // 实例公共代理
  const instance = internalInstance.proxy;
  // 拿到已处理的所有指令信息
  const bindings: DirectiveBinding[] = vnode.dirs || (vnode.dirs = []);
  // 遍历标准化指令绑定信息
  for (let i = 0; i < directives.length; i++) {
    let [dir, value, arg, modifiers = EMPTY_OBJ] = directives[i];
    if (isFunction(dir)) {
      // 指令注册时直接传递钩子函数处理为mounted和updated
      dir = {
        mounted: dir,
        updated: dir,
      } as ObjectDirective;
    }
    // 创建binding参数
    bindings.push({
      dir,
      instance,
      value,
      oldValue: void 0,
      arg,
      modifiers,
    });
  }
  return vnode;
}
```

我们先看两个类型声明，以明确`withDirectives`处理的目的。

- #### `DirectiveArguments`

```typescript
// runtime-core/directives.ts
// Directive, value, argument, modifiers
export type DirectiveArguments = Array<
  | [Directive]
  | [Directive, any]
  | [Directive, any, string]
  | [Directive, any, string, DirectiveModifiers]
>;
// 指令修饰符
export type DirectiveModifiers = Record<string, boolean>;
```

- #### `DirectiveBinding`

```typescript
// runtime-core/directives.ts
// 指令hook 第二个参数binds interface
export interface DirectiveBinding<V = any> {
  instance: ComponentPublicInstance | null;
  value: V;
  oldValue: V | null;
  arg?: string;
  modifiers: DirectiveModifiers;
  dir: ObjectDirective<any, V>;
}
```

`withDirectives`所做的就是将`DirectiveArguments`转化成`DirectiveBinding`，
我们再回看`withDirectives`的逻辑处理，先会对`app.directive()`的指令参数进行标准化处理，
然后将指令信息全部转化成`bindings`并存储在`VNode.dirs`。

## 调用指令钩子

前面我们谈到`Vue3`的指令生命周期名称已经变更为与组件生命周期同步，我们来看一下调用时机。

- #### `beforeMount` 和 `mounted`

```typescript
// runtime-core/renderer.ts
const mountElement = () =>
  // ...
  {
    // patch children
    // patch props
    if (dirs) {
      invokeDirectiveHook(vnode, null, parentComponent, "beforeMount");
    }
    if (
      (vnodeHook = props && props.onVnodeMounted) ||
      needCallTransitionHooks ||
      dirs
    ) {
      queuePostRenderEffect(() => {
        dirs && invokeDirectiveHook(vnode, null, parentComponent, "mounted");
      }, parentSuspense);
    }
  };
```

在`patch`完`children`和`props`会调用`beforeMount`，`postFlush`队列也就是组件`render`完成后调用`mounted`。

- #### `beforeUpdate` 和 `updated`

```typescript
// runtime-core/renderer.ts
const patchElement = () => {
  if (dirs) {
    invokeDirectiveHook(n2, n1, parentComponent, "beforeUpdate");
  }
  // patch children props
  // ...
  if ((vnodeHook = newProps.onVnodeUpdated) || dirs) {
    queuePostRenderEffect(() => {
      dirs && invokeDirectiveHook(n2, n1, parentComponent, "updated");
    }, parentSuspense);
  }
};
```

`beforeUpdate`会发生在`patch`完`children`和`props`之前，所有组件`render`完成后调用`updated`。

- #### `beforeUnmount` 和 `unmounted`

```typescript
// runtime-core/renderer.ts
const unmount: UnmountFn = () => {
  if (shouldInvokeDirs) {
    invokeDirectiveHook(vnode, null, parentComponent, "beforeUnmount");
  }
  // 卸载元素
  // ...
  if ((vnodeHook = props && props.onVnodeUnmounted) || shouldInvokeDirs) {
    queuePostRenderEffect(() => {
      shouldInvokeDirs &&
        invokeDirectiveHook(vnode, null, parentComponent, "unmounted");
    }, parentSuspense);
  }
};
```

`beforeUnmount`会发生在卸载元素前，卸载完成后调用`unmount`。

`SSR`相关的生命周期没有给出来，我们重点关注`client`端；接下来我们来看一看`invokeDirectiveHook`是如何调用生命周期钩子的。

```typescript
// runtime-core/directives.ts
export function invokeDirectiveHook(
  vnode: VNode,
  prevVNode: VNode | null,
  instance: ComponentInternalInstance | null,
  name: keyof ObjectDirective
) {
  // 取出绑定的指令信息
  const bindings = vnode.dirs!;
  const oldBindings = prevVNode && prevVNode.dirs!;
  // 遍历调用hooks
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (oldBindings) {
      binding.oldValue = oldBindings[i].value;
    }
    const hook = binding.dir[name] as DirectiveHook | undefined;
    if (hook) {
      callWithAsyncErrorHandling(hook, instance, ErrorCodes.DIRECTIVE_HOOK, [
        vnode.el,
        binding,
        vnode,
        prevVNode,
      ]);
    }
  }
}
```

得益于`withDirectives`的标准化指令信息，`invokeDirectiveHook`仅需要遍历调用相应的钩子函数即可。

## 总结

这就是指令系统的实现还是非常简单的，整体的设计就是将`patch`阶段的一些可操作性`Dom`的时机通过钩子函数交由外部自定义。
这也为我们提供了强大的底层`Dom`操作的抽象能力。
