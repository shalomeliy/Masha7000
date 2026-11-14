import { describe, expect, it } from 'vitest'
import { cleanVehicle, hasSamples, jobVehicleText, pickModel, pickVehicle, randomPlate, SAMPLE_COUNT, sampleVehicles, VEHICLE_FIELDS, vehicleError, vehicleModels, vehiclesOfModel } from './vehicles'
import type { Vehicle } from '../types/models'

const v = (id: string, plate: string, model = ''): Vehicle => ({ id, values: { plate, ...(model ? { model } : {}) } })
const fleet = [v('1', '12-345-67', 'הילוקס'), v('2', '22-222-22', 'אקטרוס'), v('3', '33-333-33', 'הילוקס')]

describe('vehicles', () => {
  it('a card has three fields: plate, model, make; values of removed fields are dropped on save', () => {
    expect(VEHICLE_FIELDS.map((f) => f.id)).toEqual(['plate', 'model', 'make'])
    expect(cleanVehicle({ id: 'x', values: { plate: '1', model: 'Caddy', make: 'Volkswagen', testUntil: '2027-01-01', driver: 'w1', type: 'מסחרי' } }).values).toEqual({ plate: '1', model: 'Caddy', make: 'Volkswagen' })
  })

  it('needs a plate, and the same plate twice is refused whatever the dashes', () => {
    expect(vehicleError(v('9', ' '), fleet)).toBe('צריך למלא מספר רישוי')
    expect(vehicleError(v('9', '1234567'), fleet)).toBe('רכב עם מספר הרישוי הזה כבר קיים')
    expect(vehicleError(v('1', '12-345-67'), fleet)).toBeNull()
    expect(cleanVehicle({ id: 'x', values: { plate: ' 1 ', km: '  ' } }).values).toEqual({ plate: '1' })
  })

  it('a model narrows the plates, a plate brings its model', () => {
    expect(vehicleModels(fleet)).toEqual(['אקטרוס', 'הילוקס'])
    expect(vehiclesOfModel(fleet, 'הילוקס').map((x) => x.id)).toEqual(['1', '3'])
    expect(pickVehicle('2', fleet)).toEqual({ vehicleId: '2', vehicleModel: 'אקטרוס' })
    expect(pickModel({ vehicleId: '2' }, 'הילוקס', fleet)).toEqual({ vehicleModel: 'הילוקס', vehicleId: undefined })
    expect(pickModel({ vehicleId: '1' }, 'הילוקס', fleet)).toEqual({ vehicleModel: 'הילוקס', vehicleId: '1' })
    expect(jobVehicleText({ vehicleId: '1' }, fleet)).toBe('12-345-67 · הילוקס')
    expect(jobVehicleText({ vehicleId: 'gone' }, fleet)).toBe('רכב שנמחק')
    expect(jobVehicleText({ vehicleModel: 'אקטרוס' }, fleet)).toBe('אקטרוס')
  })
})

describe('example vehicles', () => {
  it('makes the owner list with Israeli plates, none taken twice', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const list = sampleVehicles(fleet, rand)
    expect(list).toHaveLength(SAMPLE_COUNT)
    expect(SAMPLE_COUNT).toBe(14)
    expect(hasSamples(list)).toBe(true)
    expect(hasSamples(fleet)).toBe(false)
    for (const x of list) expect(x.values.plate).toMatch(/^(\d{2}-\d{3}-\d{2}|\d{3}-\d{2}-\d{3})$/)
    expect(new Set(list.map((x) => x.values.plate)).size).toBe(14)
    expect(list[2].values).toMatchObject({ make: 'Chevrolet', model: 'Silverado 2500HD / 3500HD' })
    expect(Object.keys(list[0].values).sort()).toEqual(['make', 'model', 'plate'])
    expect(randomPlate(() => 0.1)).toBe('11-111-11')
  })
})
