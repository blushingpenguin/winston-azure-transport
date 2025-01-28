import {
    AzureBlobTransport, DEFAULT_NAME_FORMAT, IAzureBlobTransportOptions
} from "./AzureBlobTransport";

export function getAzureBlobTransport(
    config?: Partial<IAzureBlobTransportOptions>
): AzureBlobTransport | null {
    const containerUrl = config?.containerUrl ||
        (process && process.env && process.env.DIAGNOSTICS_AZUREBLOBCONTAINERSASURL);
    if (typeof(containerUrl) !== "string" || !containerUrl) {
        return null;
    }

    let retention: number | undefined;
    const retentionVal = config?.retention ||
        (process.env && process.env.DIAGNOSTICS_AZUREBLOBRETENTIONINDAYS);
    if (retentionVal && typeof(retentionVal) !== "number") {
        retention = parseInt(retentionVal, 10);
    }

    let nameFormat = config?.nameFormat ||
        (process.env.WEBSITE_NAME ? `${process.env.WEBSITE_NAME}/${DEFAULT_NAME_FORMAT}` : DEFAULT_NAME_FORMAT);
    // console.log(`nameFormat=${nameFormat}`);
    return new AzureBlobTransport({
        ...config,
        containerUrl,
        nameFormat,
        retention
    });
}
