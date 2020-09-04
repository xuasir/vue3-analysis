### 依赖注入

`Vue3`提供了`provide`和`inject`方法来实现依赖注入，功能类似**2.x**的`provide/inject`选项；
两个`API`都只能在`setup`环境中运作，基本的`API`形态如下：

```typescript
const someKey = Symbol();

const provider = {
  setup() {
    provide(someKey, 1);
  },
};

const consumer = {
  setup() {
    const num = inject(someKey, 2 /* default value */);
  },
};
```

`inject`第二个参数为可选的默认值，同时`provide`也能注入一个响应式的数据，在`inject`取出来后依旧能被侦听。

## 函数概览

```typescript
// runtime-core/apiInject.ts
interface InjectionKey<T> extends Symbol {}

function provide<T>(key: InjectionKey<T> | string, value: T): void;

// 未传，使用缺省值
function inject<T>(key: InjectionKey<T> | string): T | undefined;
// 传入了默认值
function inject<T>(key: InjectionKey<T> | string, defaultValue: T): T;
```

我们直接通过类型声明来了解快速预览这两个函数的参数类型。

## `provide`

首先看到`provide`的函数体：

```typescript
// runtime-core/apiInject.ts
export function provide<T>(key: InjectionKey<T> | string, value: T) {
  if (!currentInstance) {
    // 不在setup中调用直接警告
    if (__DEV__) {
      warn(`provide() can only be used inside setup().`);
    }
  } else {
    // 取出provides
    let provides = currentInstance.provides;
    // 取出父组件的provide
    const parentProvides =
      currentInstance.parent && currentInstance.parent.provides;
    // 默认情况下一个组件的provides是继承自父组件
    // 但是如果需要在自己的provides中注入内容时
    // 需要创建一个原型指向父组件provides的对象来注入
    if (parentProvides === provides) {
      // 创建一个原型指向父组件的provides
      provides = currentInstance.provides = Object.create(parentProvides);
    }
    // 注入键值
    provides[key as string] = value;
  }
}
```

我们只需要明确`provides`的设计是默认继承自父组件，但是如果需要在自己的 provides 中注入内容时会需要创建一个原型指向父组件 provides 的对象来注入；
就能很简单的理解这段逻辑了。  
`provides`继承父组件的代码：

```typescript
// runtime-core/component.ts
const instance: ComponentInternalInstance = {
  // ...,
  provides: parent ? parent.provides : Object.create(appContext.provides),
  // ...,
};
```

## `inject`

```typescript
export function inject(
  key: InjectionKey<any> | string,
  defaultValue?: unknown
) {
  // 获取当前instance
  const instance = currentInstance || currentRenderingInstance;
  if (instance) {
    // 取出 provides
    const provides = instance.provides;
    if (key in provides) {
      // 存在就返回
      return provides[key as string];
    } else if (arguments.length > 1) {
      // 不存在该key 返回默认值
      return defaultValue;
    } else if (__DEV__) {
      // 否则抛出警告在开发环境下
      warn(`injection "${String(key)}" not found.`);
    }
  } else if (__DEV__) {
    // 抛出警告 只能在 setup和函数组件中使用
    warn(`inject() can only be used inside setup() or functional components.`);
  }
}
```

我们知道`in`操作符是会向原型链上去查找的，这样就能获取到任意父组件注入的键值了；
当然通过原型的查找会在找到相应 key 后就不再向上查找，这时候我们`inject`了一个`key`是在`provides`链上注入了多次的，
会取最近的一次注入的值。

## 思考

#### - 为什么要默认继承父组件的`provides`？

在真实的项目中我们的组件树深度会变得非常大，如果在根组件注入了一些内容，每一层组件都去创建一个`provides`这笔性能开销也是很大的，
而且在每次创建`provides`都会以父组件的`provides`作为原型，如果每层都创建这会造成原型链变得非常的冗长，直接影响到`inject`取数据的性能；
所以基于这些原因`Vue3`在处理`provides`时会优先采取直接继承拿到引用。

## 总结

`provide`和`inject`的处理方式还是十分简单的，但是需要我们对原型链以及`Object.create()`的行为有一定的了解，
这都属于`javascript`非常基础的内容；整体来说`provides`的链条设计还是很巧妙的运用了原型链的特性来处理不同层级的注入，
而`in`操作符的按原型链向上查找也很符合`inject`的行为，这也很好的回答了`ES6`时代，我们有`class`继承还需要学习原型链吗？
本质的东西还是得学习掌握。
