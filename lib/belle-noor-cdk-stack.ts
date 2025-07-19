import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps, aws_ec2 as ec2, aws_ecs as ecs, aws_ecr_assets as ecrAssets, aws_elasticloadbalancingv2 as elbv2, aws_ecs_patterns as ecs_patterns } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { aws_elasticache as elasticache, aws_ec2 } from 'aws-cdk-lib';


export class BelleNoorCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'BelleNoorVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'PublicSubnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    const cluster = new ecs.Cluster(this, 'BelleNoorCluster', {
      vpc,
      containerInsights: true,
    });

    // Create Redis Subnet Group
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis',
      subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
      cacheSubnetGroupName: 'belle-noor-redis-subnet-group',
    });

    // Security Group for Redis
    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
      description: 'Allow ECS tasks to access Redis',
      allowAllOutbound: true,
    });

    // Allow ECS tasks to connect to Redis
    redisSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(6379),
      'Allow Redis access'
    );

    // Create Redis Cluster (Single Node)
    const redisCluster = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      cacheNodeType: 'cache.t3.micro',
      engine: 'redis',
      numCacheNodes: 1,
      clusterName: 'belle-noor-redis',
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName!,
    });

    const imageAsset = new ecrAssets.DockerImageAsset(this, 'AppImage', {
      directory: path.join(__dirname, '../app'),
      platform: ecrAssets.Platform.LINUX_AMD64, // ✅ Ensure it's built for Fargate-compatible architecture
    });

    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'FargateService', {
      cluster,
      cpu: 256,
      desiredCount: 1,
      memoryLimitMiB: 512,
      publicLoadBalancer: true,
      taskSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      assignPublicIp: true,
      taskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(imageAsset),
        containerPort: 80,
        containerName: 'belle-noor-backend',
        environment: {
          NODE_ENV: 'production'
        }
      },
      healthCheckGracePeriod: cdk.Duration.seconds(30),
      listenerPort: 80,
    });

    fargateService.targetGroup.configureHealthCheck({
      path: '/health',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyHttpCodes: '200',
    });
    fargateService.taskDefinition.defaultContainer?.addEnvironment('REDIS_HOST', redisCluster.attrRedisEndpointAddress);
    fargateService.taskDefinition.defaultContainer?.addEnvironment('REDIS_PORT', '6379');
  }
}
