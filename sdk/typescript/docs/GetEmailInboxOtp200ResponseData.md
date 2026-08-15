
# GetEmailInboxOtp200ResponseData


## Properties

Name | Type
------------ | -------------
`otp` | string
`receivedAt` | Date
`messageId` | string
`from` | string

## Example

```typescript
import type { GetEmailInboxOtp200ResponseData } from '@programmableinbox/sdk'

// TODO: Update the object below with actual values
const example = {
  "otp": 123456,
  "receivedAt": null,
  "messageId": msg-1,
  "from": noreply@example.com,
} satisfies GetEmailInboxOtp200ResponseData

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GetEmailInboxOtp200ResponseData
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


