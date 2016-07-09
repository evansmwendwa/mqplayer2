import { Injectable } from '@angular/core';
import { DriveFile } from './drive-file';
import { DRIVE_FILES } from './mock-files';
import {Deferred} from "app/deferred";

export class DriveService {
    CLIENT_ID = '97071318931-0pqadkdeov03b36bhthnri1n3h64eg7d.apps.googleusercontent.com';
    SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
    authorized: boolean;
    token: string;
    user: any;

    constructor() {
        loadDriveAPI();
    }

    getFiles(parent?: DriveFile): Promise<DriveFile[]> {
        var parentId = parent ? parent.id : 'root';

        var query = `'${parentId}' in parents`;

        if (!parent) {
            query = `(sharedWithMe or ${query})`;
        }

        return this.query(query)
            .then(files => this.checkSubfolders(files))
            .then(files => {
                return files.map(file => this.convertFile(file))
                    .sort(this.fileComparator);
            })
            .then(files => parent.children = files);
    }

    private checkSubfolders(files) {
        var parents = {};

        files.forEach(f => {
            if (f.mimeType == 'application/vnd.google-apps.folder') {
                parents[f.id] = f;
            }
        });

        var parentIds = Object.keys(parents);

        if (!parentIds.length) {
            return files;
        }

        var query = parentIds
            .map(id => `'${id}' in parents`)
            .join(' or ');

        query = `(${query}) and mimeType = 'application/vnd.google-apps.folder'`;

        return this.query(query).then(subfolders => {
            subfolders.forEach(f => {
                f.parents.forEach(p => {
                    if (parents[p]) {
                        parents[p].hasSubfolders = true;
                    }
                })
            });
            return files;
        });
    }

    authorize() {
        return new Promise((resolve, reject) => {
            gapi.auth.authorize({client_id: this.CLIENT_ID, scope: this.SCOPES.join(' '), immediate: false},
                resp => {
                    if (resp && !resp.error) {
                        this.authorized = true;
                        this.token = gapi.auth.getToken().access_token;
                        resolve();
                    }
                    else {
                        this.authorized = false;
                        reject(resp && resp.error);
                    }
                });
        })
            .then(() => this.getUserInfo());
    }

    private getUserInfo() {
        return new Promise((resolve, reject) => {
            gapi.client.drive.about.get({
                fields: 'user/*,storageQuota/*'
            }).execute(resp => {
                if (resp.error) {
                    reject(`${resp.error.code} ${resp.error.message}`);
                }
                else {
                    this.user = {
                        name: resp.user.displayName,
                        email: resp.user.emailAddress,
                        storage: resp.storageQuota
                    };
                    resolve(this.user);
                }
            });
        });
    }

    private query(query) {
        query = query + ' and trashed = false';

        var deferred = new Deferred();

        this.getPageOfFiles(query, [], deferred, null);

        return deferred.promise;
    }

    private getPageOfFiles(query, result, deferred, pageToken) {
        var request = gapi.client.drive.files.list({
            q: query,
            fields: 'nextPageToken, files(id, name, mimeType, parents)',
            pageToken: pageToken
        });

        request.execute(resp => {
            if (!resp.error) {
                if (resp.files) {
                    result.push(...resp.files);
                }

                if (resp.nextPageToken) {
                    this.getPageOfFiles(query, result, deferred, resp.nextPageToken);
                }
                else {
                    deferred.resolve(result);
                }
            }
            else {
                if (resp.error.code == 401) {
                    // trying to refresh token and execute the same request again
                    console.log(new Date(), 'Refreshing the token...');
                    this.refreshToken()
                        .then(() => {
                            this.getPageOfFiles(query, result, deferred, pageToken)
                        })
                        .catch(() => {
                            var error = resp.error.code + " " + resp.error.message;
                            deferred.reject('Failed to refresh token:' + error);
                        });
                }
                else {
                    var error = resp.error.code + " " + resp.error.message;
                    deferred.reject(error);
                }
            }
        });
    }

    private refreshToken() {
        var deferred = new Deferred();

        gapi.auth.authorize({client_id: this.CLIENT_ID, scope: this.SCOPES.join(' '), immediate: true}, resp => {
            if (!resp.error) {
                deferred.resolve();
            }
            else {
                deferred.reject(resp.error.code + " " + resp.error.message);
            }
        });

        return deferred.promise;
    }

    private convertFile(rawFile) {
        return new DriveFile(rawFile.id, rawFile.name, rawFile.mimeType == 'application/vnd.google-apps.folder', rawFile.hasSubfolders);
    }

    private fileComparator(a: DriveFile, b: DriveFile) {
        if (a.isFolder === b.isFolder) {
            return a.name < b.name ? -1 : 1;
        }
        else {
            return a.isFolder ? -1 : 1;
        }
    }
}

function loadDriveAPI() {
    return new Promise((resolve, reject) => {
        window.gapi_loaded = function() {
            gapi.client.load('drive', 'v3', function() {
                resolve();
            });
        };
        var script = document.createElement('script');
        script.type = 'text/javascript';
        script.async = true;
        script.src = 'https://apis.google.com/js/client.js?onload=gapi_loaded';
        document.getElementsByTagName('head')[0].appendChild(script);
    });
}