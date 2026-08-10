
# EmailInbox

An email inbox

## Properties

Name | Type
------------ | -------------
`id` | string
`organizationId` | string
`email` | string
`name` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { EmailInbox } from '@programmableinbox/sdk'

// TODO: Update the object below with actual values
const example = {
  "id": inbox-1,
  "organizationId": org-1,
  "email": support@example.com,
  "name": Support Inbox,
  "createdAt": null,
  "updatedAt": null,
} satisfies EmailInbox

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EmailInbox
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


