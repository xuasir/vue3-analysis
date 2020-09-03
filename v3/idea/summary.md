### 总结及准备工作

我们先后聊了`Vue3`的平衡性设计和内部的基本框架、职能分布，还深入探讨了`Vue3 composition API`带来的描述**UI**的方式以及`Vue3`的升级点，
也算是从内在设计到表现形式都有了一定程度的理解，相信我们在接下来深入源码的时候，我们至少能做到在一开始就能了解模块的主要职能和基本思路。

## 前置准备

看源码光看肯定是不够的，咱们需要一个好的测试环境，来进行`debugger`之类的操作，
本次我是用的环境是直接在`vue-next`代码仓库中来运行`vue3`，基于版本：`3.0.0-rc.4`；
这样的话也不用打开两个`ide`来回切换在源码和运行仓库中；环境准备步骤如下：

> 1. 克隆代码仓库
>    `git clone https://github.com/vuejs/vue-next.git`
>
> 2. 安装依赖
>
>    `npm i`
>
> 3. 修改`rollup`配置开启生产打包`sourceMap`
>
>    1、打开项目根目录的 rollup.config.js
>    2、找到第 83 行的 output.sourcemap = !!process.env.SOURCE_MAP
>    3、至设置成 output.sourcemap = true
>
> 4. 打包生成`vue3`
>
>    `npm run build`
>
> 5. 打开`src`下的`vue`文件夹，在`examples`中新建`demo`文件夹，在`demo`中创建一个 html 如下：

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>vue3</title>
    <script src="../../dist/vue.global.js"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
  <script>
    let { ref } = Vue;
    const App = {
      template: `
      <div id="root" @click="add">
        {{ num }}
      </div>
    `,
      setup() {
        let num = ref(0);
        return {
          num,
        };
      },
    };

    Vue.createApp(App).mount("#app");
  </script>
</html>
```

> 6. vue3 的生产源文件存放在`examples`的同级目录`dist`下，需要测试即可在源文件中打上`debugger`
> 7. 直接将`demo/index.html`在浏览器打开即可

至此关于代码调试的准备已经做完，在下一篇幅中将开始解析`vue3 runtime`。
