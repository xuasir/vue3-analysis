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
          collapsable: false,
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
          collapsable: false,
          children: [
            ['runtime/', '前言'],
            {
              title: '核心流程',
              collapsable: false,
              children: [
                'runtime/createApp',
                'runtime/mount',
                'runtime/update',
                'runtime/setup'
              ]
            },
          ]
        },
        {
          title: 'reactivity篇',
          collapsable: false,
          children: [
            ['reactivity/', '前言'],
            {
              title: '核心方法',
              collapsable: false,
              children: [
              ]
            },
          ]
        }
      ]
    }
  }
}