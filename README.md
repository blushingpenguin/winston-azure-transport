# winston-azure-transport

[![NPM version](https://badge.fury.io/js/winston-azure-transport.png)](http://badge.fury.io/js/winston-azure-transport)

A [Windows Azure][0] blob storage transport for [winston][1].  This is intended to replicate
the "log to blob container functionality" found in Azure for node or iisnode applications,
including log rollover and expiry in an easy to configure manner.

This borrows heavily from an original coffeescript version by [Parsimotion][2], however it only requires a container SAS and works with winston 3.

## Installation

``` bash
  $ npm install winston
  $ npm install winston-azure-transport
```

## Usage from iisnode
If node is being hosted in an Azure Windows app service (using iisnode), then configuration can be made largely automatic by using the Azure provided app settings. Firstly, to enable logging to storage from the Azure portal, navigate to your app service and configure "Application Logging (Blob)" from the "Diagnostic Logs" tab.  Then add code to enable logging to your node application:

``` ts
import winston from "winston";
import { getAzureBlobTransport } from "winston-azure-transport";

const logger = winston.createLogger({
    transports: getAzureBlobTransport()
});
logger.log("info", "Hello, world!");
```

getAzureBlobTransport will return null if it doesn't detect any configuration for azure blob logging (either from the environment provided by iisnode or from appsettings passed to it).  This can be handled with code like:

```ts
function createLogger() {
    // Configure a console logger for winston
    const transports : TransportStream[] = [
        new winston.transports.Console({
            level: "info"
        })
    ];
    // Add an azure transport if configured
    const transport = getAzureBlobTransport();
    if (transport) {
        transports.push(transport);
    }
    // Create a winston logger
    const logger = winston.createLogger({
        transports
    });
    return logger;
}

```

You can also easily combine this with [express][4] using [express-winston][3]:
```ts
import express from "express";
import expressWinston from "express-winston";
import winston from "winston";
import { AzureBlobTransport, IAzureBlobTransportOptions } from "winston-azure-transport";

const app = express();

const logger = createLogger();

// Add express middleware
app.use(expressWinston.logger({
    winstonInstance,
    meta: true,
    expressFormat: true
}));

// Add more middleware
app.use(express.static("public"));
...
// etc

// Add an express error logger
app.use(expressWinston.errorLogger({
    winstonInstance
}));
```

This easily adds full logging to azure blob storage for actions and errors to iisnode applications.

## General usage

For general usage ``AzureBlobTransport`` can be directly created with options passed to the constructor as in the example below.

``` js
import winston from "winston";
import { AzureBlobTransport } from "winston-azure-transport";

const logger = winston.createLogger({
    transports: [
        new AzureBlobTransport({
            containerUrl: "https://mystorage.blob.core.windows.net/errors?sv=2018-03-28&sr=c&sig=x&st=2019-01-01T00:00:00Z&se=2219-01-01T00:00:00Z&sp=rwdl",
            nameFormat: "my-app-logs/{yyyy}/{MM}/{dd}/{hh}/node.log",
            retention: 365
        })
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

#### name
The name of the logger within winston (defaults to AzureBlobTransport).

#### nameFormat
The name format can be omitted and defaults to "{yyyy}/{MM}/{dd}/{hh}/node.log".

#### retention
The number of days to keep logs for. Log dates will be parsed according to the nameFormat option, and any logs older than the specified number of days will be deleted once per day.

#### trace
Setting ``trace: true`` in the options will enable debug messages from the logger. These go to the console.

## getAzureBlobSettings
```ts
function getAzureBlobSettings(
    config?: Partial<IAzureBlobTransportOptions>,
    appSettings?: IAzureBlobTransportAppSettings
):  AzureBlobTransport | null;
```

This function detects settings from the node environment within in an azure app service.  The environment variables ``DIAGNOSTICS_AZUREBLOBCONTAINERSASURL``, ``DIAGNOSTICS_AZUREBLOBRETENTIONINDAYS`` are used for the containerUrl and retention settings respectively.  The environment variable ``WEBSITE_SITE_NAME`` is used to provide a prefix to the nameFormat settings (in azure storage explorer, this appears as a folder with the same name as the website).

If the environment variables are not found then configuration is taken from appSettings (described below), if provided.  If neither method provides an SAS storage url then the function returns ``null``.

The ``config`` argument allows passing on any additional options to the AzureBlobTransport constructor.
The ``appSettings`` argument allows passing a json configuration file on as follows:
```ts
const appSettings = require("appsettings.json");
const transport = getAzureBlobSettings({}, appSettings);
```
With appsettings.json being something like:
```json
{
    "azureBlobContainerSasUrl": "https://mystorage.blob.core.windows.net/errors?sv=2018-03-28&sr=c&sig=x&st=2019-01-01T00:00:00Z&se=2219-01-01T00:00:00Z&sp=rwdl",
    "azureBlobContainerSasFormat": "my-folder/{yyyy}/{MM}/{dd}/{hh}/node.log",
    "azureBlobRetentionInDays": 365
}
```

[0]: http://www.windowsazure.com/en-us/develop/nodejs/
[1]: https://github.com/flatiron/winston
[2]: https://github.com/Parsimotion/winston-azure-blob-transport/blob/master/README.md
[3]: https://www.npmjs.com/package/express-winston
[4]: https://www.npmjs.com/package/express
