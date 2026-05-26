import { describe, expect, it } from 'vitest'
import { parseHourlyTrendsFromText } from './parsers'

describe('weather hourly trends parser', () => {
  it('parses times and 5 numeric series from CMA forecast text window', () => {
    const text =
      '一些别的内容 时间 11:00 14:00 17:00 20:00 23:00 02:00 05:00 08:00 ' +
      '天气 多云 多云 多云 多云 多云 多云 多云 多云 ' +
      '气温 33.2℃ 34.4℃ 35.4℃ 32.4℃ 28.2℃ 27.3℃ 27.3℃ 29℃ ' +
      '降水 无降水 无降水 无降水 无降水 无降水 无降水 无降水 无降水 ' +
      '风速 2.7m/s 2.7m/s 2.8m/s 3.3m/s 2.9m/s 2.4m/s 2.8m/s 3.3m/s ' +
      '风向 西南风 东南风 东南风 东南风 东南风 东南风 东南风 东南风 ' +
      '气压 986.8hPa 984.5hPa 983.1hPa 984.4hPa 987.3hPa 986.5hPa 987.3hPa 989.1hPa ' +
      '湿度 66% 61.6% 63.5% 68.5% 77.4% 80.5% 88% 79.2% ' +
      '云量 10.1% 10.1% 10.1% 10.1% 10.1% 10.1% 10.1% 10.1%'

    const parsed = parseHourlyTrendsFromText(text)
    expect(parsed).not.toBeNull()
    expect(parsed?.times).toEqual([
      '11:00',
      '14:00',
      '17:00',
      '20:00',
      '23:00',
      '02:00',
      '05:00',
      '08:00'
    ])
    expect(parsed?.temperatureC).toEqual([33.2, 34.4, 35.4, 32.4, 28.2, 27.3, 27.3, 29])
    expect(parsed?.precipitationMm).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(parsed?.windSpeedMs).toEqual([2.7, 2.7, 2.8, 3.3, 2.9, 2.4, 2.8, 3.3])
    expect(parsed?.humidityPercent).toEqual([66, 61.6, 63.5, 68.5, 77.4, 80.5, 88, 79.2])
    expect(parsed?.cloudPercent).toEqual([10.1, 10.1, 10.1, 10.1, 10.1, 10.1, 10.1, 10.1])
  })
})
