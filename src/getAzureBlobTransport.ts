import {
    AzureBlobTransport, DEFAULT_NAME_FORMAT, IAzureBlobTransportOptions
} from "./AzureBlobTransport";

export interface IAzureBlobTransportAppSettings {
    [key: string]: string | number
}

export function getAzureBlobTransport(
    config?: Partial<IAzureBlobTransportOptions>,
    appSettings?: IAzureBlobTransportAppSettings
): AzureBlobTransport | null {
    const containerUrl =
        process && process.env && process.env.DIAGNOSTICS_AZUREBLOBCONTAINERSASURL ||
        appSettings && appSettings.azureBlobContainerSasUrl;
    // console.log(`containerUrl=${containerUrl}`);
    if (typeof(containerUrl) !== "string" || !containerUrl) {
        return null;
    }

    let retention: number | undefined;
    const retentionVal =
        process.env && process.env.DIAGNOSTICS_AZUREBLOBRETENTIONINDAYS ||
        appSettings && appSettings.azureBlobRetentionInDays;
    if (retentionVal && typeof(retentionVal) !== "number") {
        retention = parseInt(retentionVal, 10);
    }

    let nameFormat: string|undefined;
    const namePrefix = process.env.WEBSITE_SITE_NAME;
    if (namePrefix) {
        nameFormat = `${namePrefix}/${DEFAULT_NAME_FORMAT}`;
    }
    //console.log(`nameFormat=${nameFormat}`);
    return new AzureBlobTransport({
        ...config,
        containerUrl,
        nameFormat,
        retention
    });
}
