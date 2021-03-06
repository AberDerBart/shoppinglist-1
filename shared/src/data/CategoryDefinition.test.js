// @flow
import jest from 'jest'
import { type CategoryDefinition, createCategoryDefinition } from './CategoryDefinition'
import { type UUID, createUUID } from '../util/uuid'

const id = createUUID("a58df112-085f-4742-873d-8f8e31af7826")

describe(`createCategoryDefinition`, () => {
  it(`Creates Category`, () => {
    const val : CategoryDefinition = createCategoryDefinition({
      id: id,
      name: 'Milchprodukte',
      shortName: 'M',
      color: 'yellow',
      lightText: false
    })
  })

  it(`Doesn't create category for unknown color`, () => {
    expect(() => {
      const val : CategoryDefinition = createCategoryDefinition({
        id: id,
        name: 'Milchprodukte',
        shortName: 'M',
        color: 'blau',
        lightText: false
      })
    }).toThrow('The given color "blau" is not a valid color value')
  })
})
