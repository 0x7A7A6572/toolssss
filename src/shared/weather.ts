export const WEATHER_EVENTS = {
  GET_DASHBOARD: 'weather:dashboard:get',
  GET_PROVINCE_CITIES: 'weather:provinceCities:get'
} as const

export interface WeatherProvinceCity {
  id: string
  name: string
}

export interface WeatherNow {
  stationId: string
  locationName: string
  temperatureC: number | null
  feelsLikeC: number | null
  humidityPercent: number | null
  pressureHpa: number | null
  precipitationMm: number | null
  windDirectionText: string | null
  windScaleText: string | null
  lastUpdateText: string | null
}

export interface WeatherDayForecast {
  weekText: string
  dateText: string
  dayText: string
  nightText: string | null
  windDirectionText: string | null
  windScaleText: string | null
  highC: number | null
  lowC: number | null
}

export interface WeatherHourlyPrecip {
  atText: string
  precipitationText: string
  precipitationMm: number
  inNext3Hours: boolean
}

export interface WeatherThreeHourWarning {
  willRain: boolean
  maxPrecipitationMm: number
  items: WeatherHourlyPrecip[]
}

export interface WeatherDashboard {
  now: WeatherNow
  days: WeatherDayForecast[]
  threeHour: WeatherThreeHourWarning
  fetchedAtMs: number
  sources: {
    nowUrl: string
    forecastUrl: string
  }
}
