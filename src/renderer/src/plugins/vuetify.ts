import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import {
  VBtn,
  VCard,
  VCardActions,
  VCardText,
  VCardTitle,
  VColorPicker,
  VDialog,
  VIcon,
  VMenu,
  VProgressLinear,
  VSelect,
  VSlider,
  VSpacer,
  VSwitch,
  VTextField,
  VTimePicker,
  VEmptyState
} from 'vuetify/components'
import * as directives from 'vuetify/directives'

const vuetify = createVuetify({
  components: {
    VBtn,
    VCard,
    VCardActions,
    VCardText,
    VCardTitle,
    VColorPicker,
    VDialog,
    VIcon,
    VMenu,
    VProgressLinear,
    VSelect,
    VSlider,
    VSpacer,
    VSwitch,
    VTextField,
    VTimePicker,
    VEmptyState
  },
  defaults: {
    VSelect: {
      density: 'compact',
      variant: 'outlined',
      hideDetails: true,
      singleLine: true,
      menuProps: { contentClass: 'ev-select-menu' }
    }
  },
  directives,
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi }
  },
  theme: {
    defaultTheme: 'dark'
    // themes: {
    //   dark: {
    //     colors: {
    //       primary: '#3b83f6db'
    //     }
    //   }
    // }
  }
})

export default vuetify
