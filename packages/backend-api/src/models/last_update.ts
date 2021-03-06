/*
Copyright 2017 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as Sequelize from 'sequelize';
import { sequelize } from '../sequelize';
import { IBaseAttributes, IBaseInstance } from './constants';

export interface ILastUpdateAttributes extends IBaseAttributes {
  lastUpdate: number;
}

export type ILastUpdateInstance = Sequelize.Instance<ILastUpdateAttributes> & ILastUpdateAttributes & IBaseInstance;

/**
 * Category model
 */
const LastUpdate = sequelize.define<ILastUpdateInstance, ILastUpdateAttributes>('last_updates', {
  id: {
    type: Sequelize.INTEGER.UNSIGNED,
    primaryKey: true,
  },

  lastUpdate: {
    type: Sequelize.INTEGER.UNSIGNED,
  },
});

interface IInterestListener {
  updateHappened(): Promise<void>;
  partialUpdateHappened(articleId: number): Promise<void>;
}

let lastUpdateLocal = 0;
let interested: Array<IInterestListener> = [];
let intervalHandle: NodeJS.Timer|null = null;

async function getInstance() {
  const instance = await LastUpdate.findOne({where: {id: 1}});
  if (instance) {
    return instance;
  }
  return await LastUpdate.create({id: 1, lastUpdate: 1});
}

async function updateLastUpdate() {
  const instance = await getInstance();
  lastUpdateLocal = instance.lastUpdate + 1;
  instance.lastUpdate = lastUpdateLocal;
  await instance.save();
}
export async function partialUpdateHappened(articleId: number) {
  await updateLastUpdate();
  for (const i of interested) {
    await i.partialUpdateHappened(articleId);
  }
}

export async function updateHappened() {
  await updateLastUpdate();
  for (const i of interested) {
    i.updateHappened();
  }
}

export function registerInterest(interestListener: IInterestListener, testing = false) {
  if (!testing && !intervalHandle) {
    // Poll every minute
    intervalHandle = setInterval(maybeNotifyInterested, 60000);
  }

  interested.push(interestListener);
}

// Exporting for test purposes, but should really be unexported
export async function maybeNotifyInterested() {
  const instance = await getInstance();
  const lastUpdate = instance.lastUpdate;
  if (lastUpdate !== lastUpdateLocal) {
    lastUpdateLocal = lastUpdate;
    for (const i of interested) {
      i.updateHappened();
    }
  }
}

export async function clearInterested() {
  interested = [];
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }
}
