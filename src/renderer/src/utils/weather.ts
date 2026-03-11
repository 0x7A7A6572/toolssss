import { WEATHER_EVENTS, type WeatherDashboard, type WeatherProvinceCity } from '@shared/weather'

export class WeatherTool {
  static async getDashboard(stationId = '59431'): Promise<WeatherDashboard | null> {
    const result = await window.electron.ipcRenderer.invoke(WEATHER_EVENTS.GET_DASHBOARD, stationId)
    return result as WeatherDashboard | null
  }

  static async getProvinceCities(provinceCode: string): Promise<WeatherProvinceCity[]> {
    const result = await window.electron.ipcRenderer.invoke(
      WEATHER_EVENTS.GET_PROVINCE_CITIES,
      provinceCode
    )
    return (result as WeatherProvinceCity[]) ?? []
  }
}
