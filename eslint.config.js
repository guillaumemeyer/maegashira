// https://github.com/eslint-community/eslint-plugin-security
import pluginSecurity from 'eslint-plugin-security'
// https://github.com/gajus/eslint-plugin-jsdoc
import jsdoc from 'eslint-plugin-jsdoc'

export default [
  {
    ignores: [
      'dist/*'
    ]
  },
  {
    rules: {
      // The jsdoc plugin fails to identify some standard types...
      'jsdoc/no-undefined-types': [
        'error',
        {
          definedTypes: [
            'ErrorOptions',
            'Request',
            'Response',
            'Headers',
            'Timer',
            'Window',
            'Console'
          ]
        }
      ]
    }
  },
  {
    plugins: {
      pluginSecurity,
      jsdoc
    }
  },
  pluginSecurity.configs.recommended,
  jsdoc.configs['flat/recommended']
]
