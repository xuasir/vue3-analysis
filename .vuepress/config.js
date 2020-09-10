module.exports = {
  base: '/vue3-analysis/',
  dest: 'dist',
  title: 'vue3解析',
  description: ' ',
  plugins: ['@vuepress/back-to-top'],
  themeConfig: {
    repo: 'xuguo-code/vue3-analysis',
    logo: '/logo.png',
    editLinks: false,
    docsDir: './',
    lastUpdated: '最后一次更新',
    nav: [
      {text: 'Vue3', link: '/v3/idea/vue'},
      {text: 'vue-hooks', link: 'http://xuguo.xyz/vue-hooks'},
      {text: '我要修正', link: 'https://github.com/xuguo-code/vue3-analysis/issues'},
    ],
    sidebar: {
      '/v3/': [
        {
          title: '理念篇',
          collapsable: true,
          children: [
            // 'idea/',
            'idea/vue',
            'idea/UI',
            'idea/view',
            'idea/vue3',
            'idea/summary'
          ]
        },
        {
          title: '运行时篇',
          collapsable: false,
          children: [
            ['runtime/', '前言'],
            {
              title: '组件系统',
              collapsable: true,
              children: [
                'runtime/createApp',
                'runtime/mount',
                'runtime/update',
                'runtime/setup',
                'runtime/lifecycle'
              ]
            },
            {
              title: '异步调度',
              collapsable: true,
              children: [
                'runtime/scheduler'
              ]
            },
            // {
            //   title: 'VNode',
            //   collapsable: true,
            //   children: [
            //   ]
            // },
          ]
        },
        {
          title: '响应式系统篇',
          collapsable: false,
          children: [
            ['reactivity/', '前言'],
            {
              title: '核心方法',
              collapsable: true,
              children: [
                'reactivity/reactivity',
                'reactivity/effect',
                'reactivity/computed',
                'reactivity/watch',
                'reactivity/provide'
              ]
            },
            {
              title: '更多方法',
              collapsable: true,
              children: [
                'reactivity/customRef',
                'reactivity/readonly',
                'reactivity/shallow',
                'reactivity/reactivity-utils',
              ]
            },
          ]
        },
        // {
        //   title: 'compiler篇',
        //   collapsable: true,
        //   children: [
        //     ['compiler/', '前言'],
        //   ]
        // },
        {
          title: '扩展篇',
          collapsable: false,
          children: [
            ['future/', '前言'],
            {
              title: '实用特性',
              collapsable: true,
              children: [
                'future/props',
                'future/slot',
                'future/refs',
                'future/directives',
                'future/defineAsyncComponent'
              ]
            },
            {
              title: '内建组件',
              collapsable: true,
              children: [
                'future/suspense',
                'future/teleport'
              ]
            }
          ]
        },
        // {
        //   title: '生态篇',
        //   collapsable: true,
        //   children: [
        //     ['ecology/', '前言'],
        //   ]
        // },
      ]
    }
  }
}