# winston-azure-blob-transport

[![NPM version](https://badge.fury.io/js/winston-azure-transport.png)](http://badge.fury.io/js/winston-azure-transport)

A [Windows Azure][0] blob storage transport for [winston][1].  This is intended to replicate
the "log to blob container functionality" found in Azure for node applications,
including log rollover and expiry.

This borrows heavily from an original coffeescript version by [Parsimotion][2], however it only requires a container SAS and works with winston 3.

## Installation

``` bash
  $ npm install winston
  $ npm install winston-azure-transport
```

## Usage
``` js
  import winston from "winston";
  import { AzureBlobTransport } from "winston-azure-transport";

  const logger = winston.createLogger({
    transports: [
      new AzureBlobTransport({
        containerUrl: "https://mystorage.blob.core.windows.net/errors?sv=2018-03-28&sr=c&sig=x&st=2019-01-01T00:00:00Z&se=2219-01-01T00:00:00Z&sp=rwdl",
        nameFormat: "my-app-logs/{yyyy}/{MM}/{dd}/{hh}/node.log",
        retention: 365
    ]
  });
  logger.log("info", "Hello, world!");
```

AzureBlobTransport accepts the following options:

#### containerUrl
The container url can be obtained from the Azure portal by navigating to your app service, configuring
"Application Logging (Blob)" from the "Diagnostics Logs" tab, then viewing the "DIAGNOSTICS_AZUREBLOBCONTAINERSASURL"
application setting on the "Application Settings" tab.

Alternatively you can use Azure Storage Explorer to generate the URL
by choosing "Get Shared Access Signature" from the context menu of the storage container you wish to log to.

#### nameFormat
The name format can be omitted and defaults to "{yyyy}/{MM}/{dd}/{hh}/node.log".

#### retention
The number of days to keep logs for. Log dates will be parsed according to the nameFormat option, and any logs older than the specified number of days will be deleted once per day.

#### trace
Setting ``trace: true`` in the options will enable debug messages from the logger. These go to the console.

[0]: http://www.windowsazure.com/en-us/develop/nodejs/
[1]: https://github.com/flatiron/winston
[2]: https://github.com/Parsimotion/winston-azure-blob-transport/blob/master/README.md
