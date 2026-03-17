import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import { VBtn, VCard, VColorPicker, VMenu, VSelect, VSlider, VSwitch } from 'vuetify/components'
import * as directives from 'vuetify/directives'

const vuetify = createVuetify({
  components: {
    VBtn,
    VCard,
    VColorPicker,
    VMenu,
    VSelect,
    VSlider,
    VSwitch
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
  }
})

export default vuetify
