import { setupTestRunner } from '@keystone-6/api-tests/test-runner'
import { list } from '@keystone-6/core'
import { allOperations, allowAll } from '@keystone-6/core/access'
import { relationship, text } from '@keystone-6/core/fields'
import { gen, sampleOne } from 'testcheck'
import { expectSingleRelationshipError } from '../../utils'

const alphanumGenerator = gen.alphaNumString.notEmpty()

const runner = setupTestRunner({
  serve: true,
  config: {
    lists: {
      Note: list({
        access: allowAll,
        fields: {
          content: text(),
        },
      }),
      User: list({
        access: allowAll,
        fields: {
          username: text(),
          notes: relationship({ ref: 'Note', many: true }),
        },
      }),
      NoteNoRead: list({
        access: {
          operation: { ...allOperations(allowAll), query: () => false },
        },
        fields: {
          content: text(),
        },
      }),
      UserToNotesNoRead: list({
        access: allowAll,
        fields: {
          username: text(),
          notes: relationship({ ref: 'NoteNoRead', many: true }),
        },
      }),
      NoteNoCreate: list({
        access: {
          operation: { ...allOperations(allowAll), create: () => false },
        },
        fields: {
          content: text(),
        },
      }),
      UserToNotesNoCreate: list({
        access: allowAll,
        fields: {
          username: text(),
          notes: relationship({ ref: 'NoteNoCreate', many: true }),
        },
      }),
    },
  },
})

describe('no access control', () => {
  test(
    'set: [] removes all items from list',
    runner(async ({ context }) => {
      const noteContent = `foo${sampleOne(alphanumGenerator)}`
      const noteContent2 = `foo${sampleOne(alphanumGenerator)}`

      // Create two items with content that can be matched
      const createNote = await context.query.Note.createOne({ data: { content: noteContent } })
      const createNote2 = await context.query.Note.createOne({
        data: { content: noteContent2 },
      })

      // Create an item to update
      const createUser = await context.query.User.createOne({
        data: {
          username: 'A thing',
          notes: { connect: [{ id: createNote.id }, { id: createNote2.id }] },
        },
      })

      // Update the item and link the relationship field
      const user = await context.query.User.updateOne({
        where: { id: createUser.id },
        data: { username: 'A thing', notes: { set: [] } },
        query: 'id notes { id content }',
      })

      expect(user).toMatchObject({ id: expect.any(String), notes: [] })
    })
  )

  test(
    'set: [] works in create',
    runner(async ({ context }) => {
      const noteContent = `foo${sampleOne(alphanumGenerator)}`
      const noteContent2 = `foo${sampleOne(alphanumGenerator)}`

      // Create two items with content that can be matched
      const createNote = await context.query.Note.createOne({ data: { content: noteContent } })
      const createNote2 = await context.query.Note.createOne({
        data: { content: noteContent2 },
      })

      // Create an item to update
      const createUser = await context.query.User.createOne({
        data: {
          username: 'A thing',
          notes: { set: [{ id: createNote.id }, { id: createNote2.id }] },
        },
      })

      // Update the item and link the relationship field
      const user = await context.query.User.findOne({
        where: { id: createUser.id },
        query: 'id notes { id content }',
      })

      expect({
        ...user,
        notes: user.notes.map((note: any) => note.id).sort(),
      }).toMatchObject({
        id: expect.any(String),
        notes: [createNote.id, createNote2.id].sort(),
      })
    })
  )

  test(
    'set and connect removes all existing items and adds the items specified in set and connect',
    runner(async ({ context }) => {
      const createNote = await context.query.Note.createOne({ data: {} })
      const createNote2 = await context.query.Note.createOne({ data: {} })
      const createNote3 = await context.query.Note.createOne({ data: {} })

      // Create an item to update
      const createUser = await context.query.User.createOne({
        data: {
          username: 'A thing',
          notes: { connect: [{ id: createNote.id }] },
        },
      })

      // Update the item and link the relationship field
      const user = await context.query.User.updateOne({
        where: { id: createUser.id },
        data: {
          username: 'A thing',
          notes: { set: [{ id: createNote2.id }], connect: [{ id: createNote3.id }] },
        },
        query: 'id notes { id }',
      })
      expect(user.id).toEqual(createUser.id)
      expect(user.notes.map((note: any) => note.id).sort()).toEqual(
        [createNote2.id, createNote3.id].sort()
      )
    })
  )

  test(
    'set and disconnect throws an error',
    runner(async ({ context }) => {
      const createNote = await context.query.Note.createOne({ data: {} })

      // Create an item to update
      const createUser = await context.query.User.createOne({
        data: {
          username: 'A thing',
          notes: { connect: [{ id: createNote.id }] },
        },
      })

      // Update the item and link the relationship field
      const { data, errors } = await context.graphql.raw({
        query: `
          mutation ($id: ID!) {
            updateUser(
              where: { id: $id }
              data: { notes: { disconnect: [{ id: "c5b84f38256d3c2df59a0d9bf" }], set: [] } }
            ) {
              id
            }
          }
        `,
        variables: { id: createUser.id },
      })
      expect(data).toEqual({ updateUser: null })
      const message =
        'Input error: The "set" and "disconnect" fields cannot both be provided to to-many relationship inputs for "update" operations.'
      expectSingleRelationshipError(errors, 'updateUser', 'User.notes', message)
    })
  )
})

describe('with access control', () => {
  describe('read: false on related list', () => {
    test(
      'has no effect when specifying set: []',
      runner(async ({ context }) => {
        const noteContent = sampleOne(alphanumGenerator)

        // Create an item to link against
        const createNote = await context.sudo().query.NoteNoRead.createOne({
          data: { content: noteContent },
        })

        // Create an item to update
        const createUser = await context.sudo().query.UserToNotesNoRead.createOne({
          data: {
            username: 'A thing',
            notes: { connect: [{ id: createNote.id }] },
          },
        })

        // Update the item and link the relationship field
        await context.query.UserToNotesNoRead.updateOne({
          where: { id: createUser.id },
          data: { username: 'A thing', notes: { set: [] } },
        })

        const data = await context.sudo().query.UserToNotesNoRead.findOne({
          where: { id: createUser.id },
          query: 'id notes { id }',
        })
        expect(data.notes).toHaveLength(0)
      })
    )
  })
})
