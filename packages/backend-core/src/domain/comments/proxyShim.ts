/*
Copyright 2018 Google Inc.

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

import * as Bluebird from 'bluebird';
import * as requestRaw from 'request';
import * as striptags  from 'striptags';
import {rtrim} from 'underscore.string';

import { config } from '@conversationai/moderator-config';
import { logger } from '../../logger';

import {
  Article,
  ICommentInstance,
  IUserInstance,
} from '../../models';
import {IScoreData} from './shim';

const request = Bluebird.promisify(requestRaw) as any;
Bluebird.promisifyAll(request);

interface IBotPostData {
  sync?: boolean;

  comment: {
    commentId: number;
    plainText: string;
    htmlText: string;
    links: {
      self: string;
    };
  };

  article: {
    articleId: number;
    plainText: string;
    links: {
      self: string;
    };
  };

  includeSummaryScores: true;

  inReplyToComment?: {
    commentId: number;
    plainText: string;
    htmlText: string;
    links: {
      self: string;
    };
  };

  links: {
    callback: string;
  };
}

export function createShim(
  processMachineScore: (commentId: number, serviceUserId: number, scoreData: IScoreData) => Promise<void>) {
  const apiURL = rtrim(config.get('api_url'), '/');
  const googleScoreAuth = config.get('google_score_auth');

  return {
    /**
     * Score a single comment
     *
     * @param {object} comment  Comment to score
     * @param {object} serviceUser  Service User owning this endpoint.
     * @param {string} correlator  String used to correlate this request with any out-of-band responses.
     * @return {object} Promise object indicating whether we've finished processing this request.
     */
    sendToScorer: async (comment: ICommentInstance, serviceUser: IUserInstance, correlator: string | number) => {
      const article = await Article.findById(comment.get('articleId'));

      // Ensure data is present, otherwise an error will throw.
      if (!article) {
        logger.error(`sendToScorer: Article ${comment.get('articleId')} not found for comment ${comment.id}.`);
        throw new Error(`No article for comment ${comment.id}.  Can't score.`);
      }

      const postData: IBotPostData = {
        sync: true,
        includeSummaryScores: true,

        comment: {
          commentId: comment.id,
          plainText: striptags(comment.get('text')),
          htmlText: comment.get('text'),
          links: {
            self: apiURL + '/rest/comments/' + comment.id,
          },
        },

        article: {
          articleId: article.id,
          plainText: striptags(article.get('text')),
          links: {
            self: apiURL + '/rest/articles/' + article.id,
          },
        },

        links: {
          callback: apiURL + '/assistant/scores/' + correlator,
        },
      };

      // Check for a `replyTo`

      if (comment.get('replyTo')) {
        const replyTo = comment.get('replyTo');

        postData.inReplyToComment = {
          commentId: replyTo.id,
          plainText: striptags(replyTo.get('text')),
          htmlText: replyTo.get('text'),
          links: {
            self: apiURL + '/rest/comments/' + replyTo.id,
          },
        };
      }

      logger.info(
        `Sending comment id ${comment.id} for scoring ` +
        `by service user id ${serviceUser.id} ` +
        `to endpoint: ${serviceUser.get('endpoint')}`,
        postData,
      );

      const response = await request.postAsync({
        url: serviceUser.get('endpoint'),
        json: true,
        body: postData,
        headers: {
          Authorization: googleScoreAuth,
        },
      });

      logger.info(`Assistant Endpoint Response :: ${response.statusCode}`);

      if (response.statusCode !== 200) {
        logger.error('Error posting comment id %d for scoring.', comment.id, +
          ' Server responded with status ', response.statusCode, response.body);
        throw new Error(`Comment ${comment.id}: server failed to score.`);
      }

      await processMachineScore(comment.id, serviceUser.id, response.body);
    },
  };
}
