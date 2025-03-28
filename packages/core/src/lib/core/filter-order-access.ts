import type { KeystoneContext } from '../../types'
import { accessReturnError, extensionError, filterAccessError } from './graphql-errors'
import type { InitialisedList } from './initialise-lists'

export async function checkFilterOrderAccess(
  things: { fieldKey: string; list: InitialisedList }[],
  context: KeystoneContext,
  operation: 'filter' | 'orderBy'
) {
  const func = operation === 'filter' ? 'isFilterable' : 'isOrderable'
  const failures: string[] = []
  const returnTypeErrors: any[] = []
  const accessErrors: any[] = []
  for (const { fieldKey, list } of things) {
    const field = list.fields[fieldKey]
    const rule = field.graphql.isEnabled[operation]
    if (!rule) throw new Error('Assert failed')

    if (typeof rule === 'function') {
      let result
      try {
        result = await rule({ context, session: context.session, listKey: list.listKey, fieldKey })
      } catch (error: any) {
        accessErrors.push({ error, tag: `${list.listKey}.${fieldKey}.${func}` })
        continue
      }
      const resultType = typeof result

      // It's important that we don't cast objects to truthy values, as there's a strong chance that the user
      // has made a mistake.
      if (resultType !== 'boolean') {
        returnTypeErrors.push({ tag: `${list.listKey}.${fieldKey}.${func}`, returned: resultType })
      } else if (!result) {
        failures.push(`${list.listKey}.${fieldKey}`)
      }
    }
  }
  if (accessErrors.length) {
    throw extensionError(func, accessErrors)
  }

  if (returnTypeErrors.length) {
    throw accessReturnError(returnTypeErrors)
  }
  if (failures.length) {
    throw filterAccessError({ operation, fieldKeys: failures })
  }
}
