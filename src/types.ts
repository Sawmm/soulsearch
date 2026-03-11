/**
 * Represents a search request to the slsk API.
 */
export interface SearchRequest {
    /** The ID to assign to the search */
    id: string;
    /** The actual search query text */
    searchText: string;
}

/**
 * Represents a file found in a search result.
 */
export interface SearchResultFile {
    /** The filename of the result */
    filename: string;
    /** The size of the file in bytes */
    size: number;
    /** The bitrate of the file, if applicable */
    bitRate?: number;
    /** The length of the file in seconds, if applicable */
    length?: number;
    /** The raw object from slsk-client for protocol compatibility */
    raw: any;
}

/**
 * Represents a search result from a specific user.
 */
export interface SearchResult {
    /** The username of the user who has the files */
    username: string;
    /** List of files matched from this user */
    files: SearchResultFile[];
    /** Has free upload slots */
    hasFreeUploadSlot: boolean;
    /** Average speed in bytes per second */
    uploadSpeed: number;
    /** Number of queued uploads */
    queueLength: number;
}

/**
 * Represents the response from the slsk search API.
 */
export interface SlskdSearchResponse {
    /** The ID of the search */
    id: string;
    /** The search state (e.g., InProgress, Completed) */
    state: string;
    /** The search query text */
    searchText: string;
    /** The results of the search grouped by user */
    responses: SearchResult[];
}

/**
 * Represents a download task.
 */
export interface DownloadTask {
    id: string;
    filename: string;
    username: string;
    size: number;
    progress: number;
    status: 'downloading' | 'completed' | 'error';
    localPath?: string;
    errorMessage?: string;
}

/**
 * Represents a Discogs search result.
 */
export interface DiscogsResult {
    id: number;
    title: string;
    year?: string;
    label?: string[];
    genre?: string[];
    style?: string[];
    country?: string;
    cover_image?: string;
    resource_url: string;
}

/**
 * App Configuration
 */
export interface AppConfig {
    username: string;
    password: string;
    downloadPath: string;
    sharePath: string;
    portForwarded: boolean;
    discogsToken?: string;
    search: {
        audioExtensions: string[];
        minBitrate: number;
        sortBy: 'size' | 'bitrate' | 'user';
        sortOrder: 'asc' | 'desc';
    };
    ui: {
        viewportSize: number;
        showBitrate: boolean;
        showSlots: boolean;
    };
}
