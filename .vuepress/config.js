module.exports = {
  base: '/vue3-analysis/',
  dest: 'dist',
  title: 'vue3解析',
  description: '解析vue3原理及设计思想',
  themeConfig: {
    repo: 'xuguo-code/vue3-analysis',
    logo: '/logo.png',
    editLinks: false,
    docsDir: './',
    lastUpdated: '最后一次更新',
    nav: [
      {text: 'Vue3', link: '/v3/idea/'},
      {text: 'vue-hooks', link: 'http://xuguo.xyz/vue-hooks'}
    ],
    sidebar: {
      '/v3/': [
        {
          title: '理念篇',
          collapsable: true,
          children: [
            'idea/',
            'idea/vue',
            'idea/UI',
            'idea/view',
            'idea/vue3',
            'idea/summary'
          ]
        },
        {
          title: 'runtime篇',
          collapsable: true,
          children: [
            ['runtime/', '前言'],
            'runtime/createApp',
            'runtime/mount',
            'runtime/update',
            'runtime/setup'
          ]
        },
        {
          title: 'reactivity篇',
          collapsable: true,
          children: [
            ['reactivity/', '前言'],
            {
              title: '核心方法',
              collapsable: true,
              children: [
                'reactivity/reactivity',
                'reactivity/effect',
                'reactivity/computed'
              ]
            }
          ]
        },
        {
          title: 'compiler篇',
          collapsable: true,
          children: [
            ['compiler/', '前言'],
          ]
        },
        {
          title: '实用特性篇',
          collapsable: true,
          children: [
            ['future/', '前言'],
          ]
        },
        {
          title: '生态篇',
          collapsable: true,
          children: [
            ['ecology/', '前言'],
          ]
        },
      ]
    }
  }
}