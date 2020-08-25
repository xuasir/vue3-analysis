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
    nav: [{text: 'Vue3', link: '/v3/idea/'}],
    sidebar: {
      '/v3/': [
        {
          title: '理念篇',
          collapsable: false,
          children: [
            'idea/',
            'idea/vue',
            'idea/view',
            'idea/UI'
          ]
        }
      ]
    }
  }
}