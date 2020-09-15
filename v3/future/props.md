### `Props`系统

在`Vue`中处理父子组件的通讯时，常用到`Props`来实现父到子的单向数据流传递，来实现组件的对外配置化或者一些高级功能；
我们通过一个实例来更加直观的了解`props`的使用：

```vue
<template> {{ title }}-{{ desc }} </template>
<script>
export default {
  name: "child",
  props: {
    title: String,
    desc: String,
  },
};
</script>
```

使用：

```html
<child :title="'标题'" :desc="'描述'" />
```

`props`很好的解决了父到子组件的数据传递问题，让子组件能在类似的功能下通过`props`的差异化实现复用；
本篇会深入`Props`的原理，解析`Vue3`中`Props`的全流程。

## 本篇目标

1. 理解`props`的整个生命周期
2. 理解`props`的解析方式

## 解析

对于`Props`的解析，我们会从`porps`初始化和`props`更新两个流程来深入解析。

::: tip 注意
在`Vue`的组件系统中，`props`大致可以分为三类：

1. `props options`声明过的： `props`
2. `emits options`声明过的： `emits`
3. 除以上两种外剩下的： `attrs`
   :::

## `props` 的初始化

`props`在整个组件的生命周期中是属于最先被初始化的一类数据，初始化`props`的时机就发生在组件实例创建后开始执行`setup`之前：

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
  // 初始化props
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

初始化`Props`需要接受组件实例、传入的`props`以及两个标识参数，我们直接看到`initProps`的函数体：

```typescript
// runtime-core/componentProps.ts
export function initProps(
  instance: ComponentInternalInstance,
  // 来自组件vnode 是传递到组件的props
  rawProps: Data | null,
  isStateful: number, // result of bitwise flag comparison
  isSSR = false
) {
  // options 声明过的是props
  const props: Data = {};
  // 未声明过传递 属于attrs
  const attrs: Data = {};
  // 设置内部对象标识
  def(attrs, InternalObjectKey, 1);
  // 全量设置props和attrs
  setFullProps(instance, rawProps, props, attrs);
  // 开发环境下 进行props的校验
  if (__DEV__) {
    validateProps(props, instance.type);
  }

  if (isStateful) {
    // 带状态的组件
    instance.props = isSSR ? props : shallowReactive(props);
  } else {
    if (!instance.type.props) {
      // 函数式组件未声明props 将 attrs 当做 props
      instance.props = attrs;
    } else {
      // 函数式组件声明过 props
      instance.props = props;
    }
  }
  instance.attrs = attrs;
}
```

可以看出`initProps`的主要目标是依据`rawProps`和`props options`来分离出`props`和`attrs`，
最终进行组件实例`props`和`attrs`的赋值；真正的解析出`props`发生在`setFullProps`函数，让我们继续查看。

```typescript
// runtime-core/componentProps.ts
function setFullProps(
  instance: ComponentInternalInstance,
  // 传递到组件render后挂在VNode上的props
  rawProps: Data | null,
  props: Data,
  attrs: Data
) {
  // 标准化props options
  const [options, needCastKeys] = normalizePropsOptions(instance.type);
  if (rawProps) {
    for (const key in rawProps) {
      const value = rawProps[key];
      // 内部属性跳过
      if (isReservedProp(key)) {
        continue;
      }
      // 规范化key为小驼峰
      let camelKey;
      if (options && hasOwn(options, (camelKey = camelize(key)))) {
        // 选项中存在该key
        props[camelKey] = value;
      } else if (!isEmitListener(instance.type, key)) {
        // 不在组件props选项声明的key中，也不在emit中，视作attrs
        attrs[key] = value;
      }
    }
  }

  if (needCastKeys) {
    // 处理默认值 和 强制转换Boolean型
    const rawCurrentProps = toRaw(props);
    for (let i = 0; i < needCastKeys.length; i++) {
      const key = needCastKeys[i];
      props[key] = resolvePropValue(
        options!,
        rawCurrentProps,
        key,
        rawCurrentProps[key]
      );
    }
  }
}
```

这里代码逻辑虽然简单，但是出现了几个容易混淆的概念:

> `rawProps`: 使用子组件时传递的`props`，经历`render`函数以及规范化后挂载在`VNode`上  
> `props`: 初始化`props`需要求得的属性`key: value`对象绑定在组件实例上的`props`属性  
> `options`: 标准化组件选项中`props`配置后形成的组件`Props`选项

对这三个概念有了了解后，我们可以继续看`setFullProps`函数：

#### 1. 标准化 `props options`

我们都知道`Props`选项能够接受多种配置方式类似：

```typescript
props: {
  title: String,
  desc: [String, Boolean],
  sub: {
    type: String,
    required: true,
    default: ''
  }
}
```

我们需要将其标准化成对象配置的形式，并且还要标记出来需要求默认值和强制转`Boolean`的`props`；
带着这些目标我们再来看`normalizePropsOptions`函数。

```typescript
// runtime-core/componentProps.ts
export function normalizePropsOptions(
  comp: Component
): NormalizedPropsOptions | [] {
  // 使用缓存
  if (comp.__props) {
    return comp.__props;
  }
  // 取出组件props选项
  const raw = comp.props;
  // 规范后的props配置
  const normalized: NormalizedPropsOptions[0] = {};
  // 需要强制转换的key
  const needCastKeys: NormalizedPropsOptions[1] = [];

  // apply mixin/extends props
  let hasExtends = false;
  if (__FEATURE_OPTIONS_API__ && !isFunction(comp)) {
    const extendProps = (raw: ComponentOptions) => {
      const [props, keys] = normalizePropsOptions(raw);
      extend(normalized, props);
      if (keys) needCastKeys.push(...keys);
    };
    // 处理来自extends的props
    if (comp.extends) {
      hasExtends = true;
      extendProps(comp.extends);
    }
    // 处理来自mixin的props
    if (comp.mixins) {
      hasExtends = true;
      comp.mixins.forEach(extendProps);
    }
  }
  // 无props声明也无来自混入或者继承的props选项
  if (!raw && !hasExtends) {
    return (comp.__props = EMPTY_ARR);
  }

  // 数组写法 ['a', 'b']
  if (isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      if (__DEV__ && !isString(raw[i])) {
        warn(`props must be strings when using array syntax.`, raw[i]);
      }
      // 转小驼峰
      const normalizedKey = camelize(raw[i]);
      // 校验key合法性 不以$开头
      if (validatePropName(normalizedKey)) {
        // 没有配置项目，设置为空对象
        normalized[normalizedKey] = EMPTY_OBJ;
      }
    }
  } else if (raw) {
    /**
     * 对象写法
     * {
     *  key: {
     *    default: 'xx',
     *    type: xxx
     *    ...
     *  },
     *  key: type,
     *  key: [type, type],
     *  key: () => {}
     * }
     */
    if (__DEV__ && !isObject(raw)) {
      // 如果不是对象，警告 违法的props配置
      warn(`invalid props options`, raw);
    }
    for (const key in raw) {
      // 转小驼峰
      const normalizedKey = camelize(key);
      // 校验props name是否合法
      if (validatePropName(normalizedKey)) {
        // 拿到opt对象
        const opt = raw[key];
        // key: [Boolean]
        // key: () => ....
        const prop: NormalizedProp = (normalized[normalizedKey] =
          isArray(opt) || isFunction(opt) ? { type: opt } : opt);
        if (prop) {
          // 查找 Boolean 类型出现的位置
          const booleanIndex = getTypeIndex(Boolean, prop.type);
          // 查找 String 类型出现的位置
          const stringIndex = getTypeIndex(String, prop.type);
          // 标识需要强转 Boolean
          prop[BooleanFlags.shouldCast] = booleanIndex > -1;
          // 标识需要 强制转为 true
          prop[BooleanFlags.shouldCastTrue] =
            stringIndex < 0 || booleanIndex < stringIndex;
          // 如果需要 默认设置默认值 或者 转 Boolean
          if (booleanIndex > -1 || hasOwn(prop, "default")) {
            needCastKeys.push(normalizedKey);
          }
        }
      }
    }
  }
  // 缓存
  const normalizedEntry: NormalizedPropsOptions = [normalized, needCastKeys];
  comp.__props = normalizedEntry;
  return normalizedEntry;
}
```

标准化的过程无非就是将用户的多种`props`写法都转化成标准的对象配置形式，其中通过`__props`来缓存以及标准化的`props`配置，
缓存的优化方式在`Vue`中无处不在，我们可以好好学习这种空间换时间的优化思路。

`normalizePropsOptions`中首先对`mixin/extends`这些选项进行了递归处理，将其`props`属性合并过来；
然后优先处理了无具体选项配置的情况，将对应的`props`配置设置成空对象；然后对数组和函数的配置形式转化成对象配置；
值得注意的是对`BooleanFlags`两个标识位的处理，出现`Boolean`类型限制时会标识需要强制转`Boolean`，
如果`Boolean`出现在`String`类型之前会标识需要强制转为`true`；最终对标准化完成后的数据进行缓存并且返回。

#### 2. 分离 `attrs` 和 `props`

在得到标准化的组件选项后，会对传递给组件的`props`进行遍历，按之前所说的规则将`props`分离为`attrs`和`props`。

#### 3. 处理默认值和强制转换

对于标记了需要处理的`key`会通过`resolvePropValue`来处理一遍：

```typescript
// runtime-core/componentProps.ts
function resolvePropValue(
  // 标准化后的 配置项
  options: NormalizedPropsOptions[0],
  // instance props
  props: Data,
  key: string,
  value: unknown
) {
  const opt = options[key];
  if (opt != null) {
    // 处理默认值
    const hasDefault = hasOwn(opt, "default");
    // 默认值
    if (hasDefault && value === undefined) {
      const defaultValue = opt.default;
      value =
        opt.type !== Function && isFunction(defaultValue)
          ? defaultValue()
          : defaultValue;
    }
    // boolean casting
    if (opt[BooleanFlags.shouldCast]) {
      if (!hasOwn(props, key) && !hasDefault) {
        value = false;
      } else if (
        opt[BooleanFlags.shouldCastTrue] &&
        (value === "" || value === hyphenate(key))
      ) {
        value = true;
      }
    }
  }
  return value;
}
```

默认值的处理十分简单，如果该`props`配置了默认值，并且没否被赋予初值，就从`default`获取默认值（支持函数和值类型）；
`boolean casting`主要可以分为两个情况来理解：

1. 该`props`设置的`Boolean`类型的限制，但是并没有传递值和配置默认值，我们需要将其手动设置成`false`

2. 该`props`同时设置了`Boolean`和`string`的类型限制并且`Boolean`出现在`String`之前，
   此时我们传递了`""`空字符串给`props`，按优先级别处理我们需要将`props`处理为`true`。

回到`initProps`函数，我们得到了`props`和`attrs`，
仅需要根据函数组件或者状态组件的`props options`情况进行赋值就已经完成整个`props`的初始化。

## `props` 的更新

`props`的更新发生在组件重新渲染之前：

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

`updateProps`需要接受新旧`rawProps`来对比生成新的`props`和`attrs`，我们看一下它的实现方式：

```typescript
// runtime-core/componentProps.ts
export function updateProps(
  instance: ComponentInternalInstance,
  // 新的来自VNode传递的props
  rawProps: Data | null,
  // 旧的来自VNode传递的props
  rawPrevProps: Data | null,
  optimized: boolean
) {
  // 去除当前的 props 和 attrs
  const {
    props,
    attrs,
    vnode: { patchFlag },
  } = instance;
  // 获取当前props的源数据
  const rawCurrentProps = toRaw(props);
  // 获取标准化后的 props 配置
  const [options] = normalizePropsOptions(instance.type);

  if ((optimized || patchFlag > 0) && !(patchFlag & PatchFlags.FULL_PROPS)) {
    if (patchFlag & PatchFlags.PROPS) {
      // 编译器优化情况 仅需要比对动态的props
      const propsToUpdate = instance.vnode.dynamicProps!;
      for (let i = 0; i < propsToUpdate.length; i++) {
        const key = propsToUpdate[i];
        // 新值
        const value = rawProps![key];
        if (options) {
          // attrs 和 props 的分离发生在init 并且不会变更，我们仅需判断是否在 attrs
          if (hasOwn(attrs, key)) {
            // 更新新值
            attrs[key] = value;
          } else {
            const camelizedKey = camelize(key);
            // 更新新值
            props[camelizedKey] = resolvePropValue(
              options,
              rawCurrentProps,
              camelizedKey,
              value
            );
          }
        } else {
          // 不存在配置项 props = attrs
          attrs[key] = value;
        }
      }
    }
  } else {
    // 全量更新
    setFullProps(instance, rawProps, props, attrs);、
    let kebabKey: string;
    for (const key in rawCurrentProps) {
      if (
        !rawProps ||
        (!hasOwn(rawProps, key) &&
          ((kebabKey = hyphenate(key)) === key || !hasOwn(rawProps, kebabKey)))
      ) {
        // 需要处理不存在在 新rawProps中 但是存在于旧rawProps的 props
        if (options) {
          if (
            rawPrevProps &&
            (rawPrevProps[key] !== undefined ||
              rawPrevProps[kebabKey!] !== undefined)
          ) {
            // 存在于旧rawProps中并且不为undefined的prop设置为undefined
            props[key] = resolvePropValue(
              options,
              rawProps || EMPTY_OBJ,
              key,
              undefined
            );
          }
        } else {
          // 直接删除
          delete props[key];
        }
      }
    }
    // in the case of functional component w/o props declaration, props and
    // attrs point to the same object so it should already have been updated.
    if (attrs !== rawCurrentProps) {
      for (const key in attrs) {
        if (!rawProps || !hasOwn(rawProps, key)) {
          delete attrs[key];
        }
      }
    }
  }

  // 触发来自 $attrs的更新
  trigger(instance, TriggerOpTypes.SET, "$attrs");

  if (__DEV__ && rawProps) {
    validateProps(props, instance.type);
  }
}
```

`props`的更新主要分为两种情况，一是有编译器优化的模式，另一种就是全量的更新；我们分别看一下：

#### 1. 优化模式

优化模式下仅需要将`dynamicProps`存有的`key`对应的`props`更新为新的值。

#### 2. 全量更新

全量更新的模式下，会按照`initProps`的方式将新的`rawProps`设置一遍，
最终再过滤不存在于`rawProps`上且存在于`rawPrevProps`上不为`undefined`的`prop`并设置为`undefined`；
这句话比较拗口，我们通过如下的示例来辅助理解：

```html
// 更新前
<child :title="'标题'" ... />
// 更新后
<child ... />
```

这种情况我们需要将`title`设置为`undefined`。
整体来说更新逻辑还是十分简单的，现在我们还需要关注一个`validateProps`校验`props`的过程，它在初始化和更新阶段都出现了。

## `props` 的校验

```typescript
function validateProps(props: Data, comp: Component) {
  const rawValues = toRaw(props);
  const options = normalizePropsOptions(comp)[0];
  for (const key in options) {
    let opt = options[key];
    // 没有配置选项 跳过
    if (opt == null) continue;
    // 对比单个prop
    validateProp(key, rawValues[key], opt, !hasOwn(rawValues, key));
  }
}
function validateProp(
  name: string,
  value: unknown,
  prop: PropOptions,
  // 是否不存在值
  isAbsent: boolean
) {
  const { type, required, validator } = prop;
  // 必填校验
  if (required && isAbsent) {
    warn('Missing required prop: "' + name + '"');
    return;
  }
  // 非必填 允许 null undefine
  if (value == null && !prop.required) {
    return;
  }
  // 类型检测
  if (type != null && type !== true) {
    let isValid = false;
    // 标准化为数组
    const types = isArray(type) ? type : [type];
    const expectedTypes = [];
    //
    for (let i = 0; i < types.length && !isValid; i++) {
      // 通过断言函数 获取 校验结果和校验的类型
      const { valid, expectedType } = assertType(value, types[i]);
      expectedTypes.push(expectedType || "");
      isValid = valid;
    }
    if (!isValid) {
      // 未通过
      warn(getInvalidTypeMessage(name, value, expectedTypes));
      return;
    }
  }
  // 自定义校验器
  if (validator && !validator(value)) {
    warn(
      'Invalid prop: custom validator check failed for prop "' + name + '".'
    );
  }
}
```

可以看到校验适用于一定优先级别的，依次进行必填校验、类型校验和自定义校验器三种形式的校验来判断`props`的合法性。

## 总结

我们学习了`props`的初始化和更新两个流程，应该是更加了解`Vue`中`props`的设计思路了，
当然我们还需要学习缓存这种代码优化的技巧，以便写出更加具有性能优势的代码。
