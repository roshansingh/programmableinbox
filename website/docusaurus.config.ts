import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'ProgrammableInbox',
  tagline: 'A secondary inbox built for developers.',
  favicon: 'img/favicon.ico',

  url: 'https://docs.programmableinbox.com',
  baseUrl: '/',

  organizationName: 'roshansingh',
  projectName: 'programmableinbox',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/roshansingh/programmableinbox/edit/main/website/',
          docItemComponent: '@theme/ApiItem',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      'docusaurus-plugin-openapi-docs',
      {
        id: 'api',
        docsPluginId: 'classic',
        config: {
          pibx: {
            specPath: '../sdk/openapi.json',
            outputDir: 'docs/api-reference',
            sidebarOptions: {
              groupPathsBy: 'tag',
              categoryLinkSource: 'tag',
            },
          },
        },
      },
    ],
  ],
  themes: ['docusaurus-theme-openapi-docs'],

  themeConfig: {
    navbar: {
      title: 'ProgrammableInbox',
      items: [
        {
          href: 'https://github.com/roshansingh/programmableinbox',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [],
      copyright: `Copyright © ${new Date().getFullYear()} ProgrammableInbox. Built with Docusaurus.`,
    },
    prism: {
      additionalLanguages: ['bash', 'json', 'java', 'csharp', 'go'],
    },
    languageTabs: [
      { language: 'curl' },
      { language: 'Python' },
      { language: 'Go' },
      { language: 'NodeJs' },
      { language: 'Java' },
      { language: 'C#' },
    ],
  } satisfies Preset.ThemeConfig,
};

export default config;
