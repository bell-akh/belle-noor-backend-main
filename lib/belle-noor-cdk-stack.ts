import * as cdk from 'aws-cdk-lib';
import {
  Stack,
  StackProps,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_ecr_assets as ecrAssets,
  aws_elasticache as elasticache,
  aws_ecs_patterns as ecs_patterns,
  aws_s3 as s3,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';

export class BelleNoorCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ✅ New VPC with public & private subnets and NAT gateway
    const vpc = new ec2.Vpc(this, 'BelleNoorVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'PublicSubnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: 'PrivateSubnet',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // ECS Cluster in the VPC
    const cluster = new ecs.Cluster(this, 'BelleNoorCluster', {
      vpc,
      containerInsights: true,
    });

    // ✅ Redis Subnet Group in private subnets
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis',
      subnetIds: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }).subnetIds,
      cacheSubnetGroupName: 'belle-noor-redis-subnet-group',
    });

    // ✅ Security Group for Redis — only allow ECS tasks to connect
    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
      description: 'Allow ECS tasks to access Redis',
      allowAllOutbound: true,
    });

    // ✅ Security Group for ECS tasks
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      description: 'ECS task group',
      allowAllOutbound: true,
    });

    // Allow ECS security group to access Redis
    redisSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow Redis access from ECS tasks'
    );

    // ✅ Redis Cluster (Single Node - production: use replication group)
    const redisCluster = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      cacheNodeType: 'cache.t3.micro',
      engine: 'redis',
      numCacheNodes: 1,
      clusterName: 'belle-noor-redis',
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName!,
    });

    // ✅ Docker image build from local path
    const imageAsset = new ecrAssets.DockerImageAsset(this, 'AppImage', {
      directory: path.join(__dirname, '../app'),
      platform: ecrAssets.Platform.LINUX_AMD64,
    });

    // ✅ Fargate Service behind ALB (in public subnets), tasks in private subnets
    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'FargateService', {
      cluster,
      cpu: 256,
      desiredCount: 1,
      memoryLimitMiB: 512,
      publicLoadBalancer: true,
      assignPublicIp: false,
      taskSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [ecsSecurityGroup],
      taskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(imageAsset),
        containerPort: 80,
        containerName: 'belle-noor-backend',
        environment: {
          NODE_ENV: 'production',
        },
      },
      healthCheckGracePeriod: cdk.Duration.seconds(30),
      listenerPort: 80,
    });

    // Configure health check
    fargateService.targetGroup.configureHealthCheck({
      path: '/health',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyHttpCodes: '200',
    });

    // Inject Redis env vars into ECS container
    fargateService.taskDefinition.defaultContainer?.addEnvironment('REDIS_HOST', redisCluster.attrRedisEndpointAddress);
    fargateService.taskDefinition.defaultContainer?.addEnvironment('REDIS_PORT', '6379');
    // Inject Redis + S3 + CDN env vars into container


    // ✅ S3 bucket for storing image assets
const imageBucket = new s3.Bucket(this, 'ImageBucket', {
  bucketName: 'belle-noor-images',
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
  publicReadAccess: false,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
});
imageBucket.grantPut(fargateService.taskDefinition.taskRole);
imageBucket.grantRead(fargateService.taskDefinition.taskRole);
imageBucket.grantDelete(fargateService.taskDefinition.taskRole);

// ✅ CloudFront distribution
const cdn = new cloudfront.Distribution(this, 'CDN', {
  defaultBehavior: {
    origin: new origins.S3Origin(imageBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
  },
});
fargateService.taskDefinition.defaultContainer?.addEnvironment('REDIS_HOST', redisCluster.attrRedisEndpointAddress);
fargateService.taskDefinition.defaultContainer?.addEnvironment('REDIS_PORT', '6379');
fargateService.taskDefinition.defaultContainer?.addEnvironment('S3_BUCKET_NAME', imageBucket.bucketName);
fargateService.taskDefinition.defaultContainer?.addEnvironment('CDN_DOMAIN', cdn.distributionDomainName);

// Output S3 bucket name and CDN domain
new cdk.CfnOutput(this, 'ImageBucketName', {
  value: imageBucket.bucketName,
});
new cdk.CfnOutput(this, 'CDNDomain', {
  value: cdn.distributionDomainName,
});
  }
}
